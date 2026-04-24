// drawing.js – финальная версия с паузой и возобновлением анимации
(function() {
    const canvas = document.getElementById('raymarchCanvas');
    const gl = canvas.getContext('webgl');
    if (!gl) {
        alert('WebGL не поддерживается');
        return;
    }

    // Вершинный шейдер
    const vsSource = `
        attribute vec2 a_position;
        varying vec2 v_uv;
        void main() {
            v_uv = a_position * 0.5 + 0.5;
            gl_Position = vec4(a_position, 0.0, 1.0);
        }
    `;

    // Фрагментный шейдер – итеративные отражения, без рекурсии
    const fsSource = `
        precision highp float;
        varying vec2 v_uv;
        uniform float u_time;
        uniform vec2 u_resolution;

        const int MAX_STEPS = 100;
        const float MAX_DIST = 15.0;
        const float SURF_DIST = 0.003;
        const int REFLECTION_COUNT = 2;
        const float SHADOW_SOFT = 8.0;

        // ----- SDF примитивы -----
        float sdSphere(vec3 p, float r) {
            return length(p) - r;
        }
        float sdBox(vec3 p, vec3 size) {
            vec3 q = abs(p) - size;
            return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
        }
        float sdTorus(vec3 p, float r1, float r2) {
            vec2 q = vec2(length(p.xz) - r1, p.y);
            return length(q) - r2;
        }
        float sdCylinder(vec3 p, float r, float h) {
            vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
            return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
        }
        float sdPlane(vec3 p, float y) {
            return p.y - y;
        }

        // CSG операции
        float opUnion(float a, float b) { return min(a, b); }
        float opSubtract(float a, float b) { return max(a, -b); }
        float opIntersect(float a, float b) { return max(a, b); }

        // Сцена: 6 примитивов с CSG
        float sceneSDF(vec3 p, float time) {
            // Сфера (анимированная)
            vec3 sPos = vec3(sin(time)*1.2, cos(time*0.7)*0.8 + 0.5, sin(time*0.5)*1.0);
            float sphere = sdSphere(p - sPos, 0.7);
            
            // Куб с вырезом (вычитание)
            vec3 boxPos = vec3(1.5, 0.2, -1.2);
            float box = sdBox(p - boxPos, vec3(0.8, 0.8, 0.8));
            float boxCut = sdBox(p - boxPos - vec3(0.4, 0.0, 0.4), vec3(0.3, 0.9, 0.3));
            float boxWithHole = opSubtract(box, boxCut);
            
            // Тор (вращается)
            float angle = time * 0.8;
            vec3 torusPos = vec3(-1.5, 0.5, 1.0);
            vec3 torusP = p - torusPos;
            torusP.xz = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * torusP.xz;
            float torus = sdTorus(torusP, 0.8, 0.25);
            
            // Цилиндр
            float cylinder = sdCylinder(p - vec3(0.0, 0.2, 1.8), 0.5, 0.7);
            
            // Пол
            float floorPlane = sdPlane(p, -0.9);
            
            // Пересечённый куб (Intersection)
            vec3 box2Pos = vec3(2.0, 0.3, -1.8);
            float box2 = sdBox(p - box2Pos, vec3(0.6, 0.6, 0.6));
            float intersectBox = sdBox(p - box2Pos - vec3(0.2,0.2,0.2), vec3(0.4,0.4,0.4));
            float boxIntersect = opIntersect(box2, intersectBox);
            
            float scene = sphere;
            scene = opUnion(scene, boxWithHole);
            scene = opUnion(scene, torus);
            scene = opUnion(scene, cylinder);
            scene = opUnion(scene, floorPlane);
            scene = opUnion(scene, boxIntersect);
            
            return scene;
        }

        // Нормаль через градиент SDF
        vec3 getNormal(vec3 p, float time) {
            const float eps = 0.001;
            vec2 e = vec2(eps, 0.0);
            vec3 n;
            n.x = sceneSDF(p + e.xyy, time) - sceneSDF(p - e.xyy, time);
            n.y = sceneSDF(p + e.yxy, time) - sceneSDF(p - e.yxy, time);
            n.z = sceneSDF(p + e.yyx, time) - sceneSDF(p - e.yyx, time);
            return normalize(n);
        }

        // Мягкая тень
        float softShadow(vec3 ro, vec3 rd, float mint, float maxt, float k, float time) {
            float res = 1.0;
            float t = mint;
            for (int i = 0; i < 35; i++) {
                float h = sceneSDF(ro + rd * t, time);
                if (h < 0.001) return 0.0;
                res = min(res, k * h / t);
                t += h;
                if (t > maxt) break;
            }
            return clamp(res, 0.0, 1.0);
        }

        // Ambient occlusion
        float ambientOcclusion(vec3 p, vec3 n, float time) {
            float occ = 0.0;
            float scale = 1.0;
            for (int i = 0; i < 4; i++) {
                float dist = sceneSDF(p + n * 0.1 * float(i), time);
                occ += (0.1 * scale - dist) * scale;
                scale *= 0.7;
            }
            return clamp(1.0 - occ, 0.0, 1.0);
        }

        // Ray marching (возвращает расстояние или -1 если промах)
        float rayMarch(vec3 ro, vec3 rd, float time, float start, float end) {
            float depth = start;
            for (int i = 0; i < MAX_STEPS; i++) {
                vec3 p = ro + rd * depth;
                float dist = sceneSDF(p, time);
                if (dist < SURF_DIST) return depth;
                depth += dist;
                if (depth > end) return -1.0;
            }
            return -1.0;
        }

        // Материал (цвет по положению)
        vec3 getMaterialColor(vec3 p, float time) {
            vec3 sPos = vec3(sin(time)*1.2, cos(time*0.7)*0.8 + 0.5, sin(time*0.5)*1.0);
            if (length(p - sPos) < 0.72) {
                return vec3(0.8, 0.3 + sin(time)*0.3, 0.4);
            }
            vec3 boxPos = vec3(1.5, 0.2, -1.2);
            if (sdBox(p - boxPos, vec3(0.81, 0.81, 0.81)) < 0.0) {
                return vec3(0.2, 0.4, 0.9);
            }
            float angle = time * 0.8;
            vec3 torusPos = vec3(-1.5, 0.5, 1.0);
            vec3 torusP = p - torusPos;
            torusP.xz = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * torusP.xz;
            if (sdTorus(torusP, 0.8, 0.25) < 0.01) {
                return vec3(0.9, 0.7, 0.2);
            }
            if (sdCylinder(p - vec3(0.0, 0.2, 1.8), 0.51, 0.71) < 0.0) {
                return vec3(0.2, 0.8, 0.2);
            }
            vec3 box2Pos = vec3(2.0, 0.3, -1.8);
            if (sdBox(p - box2Pos, vec3(0.61, 0.61, 0.61)) < 0.0) {
                return vec3(0.8, 0.3, 0.8);
            }
            return vec3(0.6, 0.6, 0.7);
        }

        // Вычисление освещения в точке
        vec3 computeLighting(vec3 p, vec3 n, vec3 rd, float time, float shadow, float ao) {
            vec3 lightPos = vec3(2.0, 5.0, 1.5);
            vec3 lightCol = vec3(1.0, 0.95, 0.8);
            vec3 ambient = vec3(0.15, 0.1, 0.2) * ao;
            
            vec3 L = normalize(lightPos - p);
            vec3 V = -rd;
            vec3 H = normalize(L + V);
            
            float diff = max(dot(n, L), 0.0);
            float spec = pow(max(dot(n, H), 0.0), 32.0);
            
            vec3 albedo = getMaterialColor(p, time);
            vec3 diffuse = diff * albedo * lightCol;
            vec3 specular = spec * vec3(0.8) * lightCol;
            
            return ambient + (diffuse + specular) * shadow * ao;
        }

        void main() {
            vec2 uv = v_uv * 2.0 - 1.0;
            float aspect = u_resolution.x / u_resolution.y;
            uv.x *= aspect;
            
            // Камера вращается со временем
            float camAngle = u_time * 0.15;
            vec3 ro = vec3(sin(camAngle)*3.8, 2.5, cos(camAngle)*3.8);
            vec3 lookat = vec3(0.0, 0.5, 0.0);
            vec3 forward = normalize(lookat - ro);
            vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), forward));
            vec3 up = cross(forward, right);
            vec3 rd = normalize(forward + uv.x * right + uv.y * up);
            
            float t = rayMarch(ro, rd, u_time, 0.02, MAX_DIST);
            vec3 color;
            
            if (t < 0.0) {
                // Небо
                color = mix(vec3(0.4, 0.6, 0.9), vec3(0.1, 0.2, 0.4), rd.y);
            } else {
                vec3 hitPoint = ro + rd * t;
                vec3 n = getNormal(hitPoint, u_time);
                vec3 lightDir = normalize(vec3(2.0,5.0,1.5) - hitPoint);
                float shadow = softShadow(hitPoint + n * 0.02, lightDir, 0.02, 6.0, SHADOW_SOFT, u_time);
                float ao = ambientOcclusion(hitPoint, n, u_time);
                vec3 directColor = computeLighting(hitPoint, n, rd, u_time, shadow, ao);
                
                // Итеративные отражения (без рекурсии)
                vec3 reflectColor = vec3(0.0);
                vec3 currentRo = hitPoint;
                vec3 currentRd = rd;
                vec3 currentWeight = vec3(1.0);
                
                for (int i = 0; i < REFLECTION_COUNT; i++) {
                    vec3 reflectDir = reflect(currentRd, n);
                    float reflectT = rayMarch(currentRo + n * 0.02, reflectDir, u_time, 0.02, MAX_DIST);
                    if (reflectT < 0.0) break;
                    
                    vec3 reflectHit = currentRo + reflectDir * reflectT;
                    vec3 reflectN = getNormal(reflectHit, u_time);
                    vec3 reflectLightDir = normalize(vec3(2.0,5.0,1.5) - reflectHit);
                    float reflectShadow = softShadow(reflectHit + reflectN * 0.02, reflectLightDir, 0.02, 6.0, SHADOW_SOFT, u_time);
                    float reflectAO = ambientOcclusion(reflectHit, reflectN, u_time);
                    vec3 reflectLocal = computeLighting(reflectHit, reflectN, reflectDir, u_time, reflectShadow, reflectAO);
                    
                    float weight = 0.5;
                    reflectColor += reflectLocal * weight * currentWeight;
                    currentWeight *= weight;
                    
                    currentRo = reflectHit;
                    currentRd = reflectDir;
                    n = reflectN;
                    if (currentWeight.x < 0.05) break;
                }
                
                float fresnel = pow(1.0 - abs(dot(getNormal(hitPoint, u_time), -rd)), 1.2);
                color = mix(directColor, reflectColor, fresnel * 0.4);
                
                // Лёгкий туман
                float fog = 1.0 - min(1.0, t / 12.0);
                color = mix(color, vec3(0.25, 0.3, 0.4), fog * 0.3);
            }
            
            color = pow(color, vec3(1.0/2.2));
            gl_FragColor = vec4(color, 1.0);
        }
    `;

    function compileShader(src, type) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Ошибка компиляции шейдера:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    const vs = compileShader(vsSource, gl.VERTEX_SHADER);
    const fs = compileShader(fsSource, gl.FRAGMENT_SHADER);
    if (!vs || !fs) {
        alert('Ошибка компиляции шейдеров. Смотрите консоль.');
        return;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Ошибка линковки программы:', gl.getProgramInfoLog(program));
        alert('Ошибка линковки шейдерной программы.');
        return;
    }
    gl.useProgram(program);

    // Буфер вершин
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const timeUniform = gl.getUniformLocation(program, "u_time");
    const resUniform = gl.getUniformLocation(program, "u_resolution");

    let animationId = null;
    let running = true;
    let globalStartTime = null;
    let pausedTime = 0;

    function render(nowSeconds) {
        if (!running) {
            // Сохраняем последний кадр, но продолжаем цикл запросов
            animationId = requestAnimationFrame((ts) => render(ts / 1000));
            return;
        }
        const time = nowSeconds - globalStartTime;
        gl.uniform1f(timeUniform, time);
        gl.uniform2f(resUniform, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        animationId = requestAnimationFrame((ts) => render(ts / 1000));
    }

    function start() {
        if (animationId) cancelAnimationFrame(animationId);
        globalStartTime = performance.now() / 1000 - pausedTime;
        running = true;
        render(performance.now() / 1000);
    }

    function stop() {
        running = false;
        pausedTime = (performance.now() / 1000) - globalStartTime;
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }

    document.getElementById('raymarchStart').onclick = start;
    document.getElementById('raymarchStop').onclick = stop;

    function resizeCanvas() {
        const displayWidth = canvas.clientWidth;
        const displayHeight = canvas.clientHeight;
        if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
            canvas.width = displayWidth;
            canvas.height = displayHeight;
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.uniform2f(resUniform, canvas.width, canvas.height);
        }
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Инициализация и запуск
    globalStartTime = performance.now() / 1000;
    pausedTime = 0;
    running = true;
    render(performance.now() / 1000);
})();