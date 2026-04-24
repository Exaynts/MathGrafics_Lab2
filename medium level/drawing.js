    (function(){
        // ------------------------------------------------------------------
        // 1. Базовый PixelBuffer для работы с пикселями (прямой доступ)
        // ------------------------------------------------------------------
        class PixelBuffer {
            constructor(width, height) {
                this.width = width;
                this.height = height;
                this.canvas = document.createElement('canvas');
                this.canvas.width = width;
                this.canvas.height = height;
                this.ctx = this.canvas.getContext('2d');
                this.imageData = this.ctx.createImageData(width, height);
                this.data = this.imageData.data;  // Uint8ClampedArray
            }

            setPixel(x, y, r, g, b, a = 255) {
                if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
                const idx = (y * this.width + x) * 4;
                this.data[idx] = r;
                this.data[idx+1] = g;
                this.data[idx+2] = b;
                this.data[idx+3] = a;
                return true;
            }

            getPixel(x, y) {
                if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
                const idx = (y * this.width + x) * 4;
                return {
                    r: this.data[idx],
                    g: this.data[idx+1],
                    b: this.data[idx+2],
                    a: this.data[idx+3]
                };
            }

            clear(r = 12, g = 14, b = 22, a = 255) {
                for (let i = 0; i < this.data.length; i += 4) {
                    this.data[i] = r;
                    this.data[i+1] = g;
                    this.data[i+2] = b;
                    this.data[i+3] = a;
                }
            }

            syncFromData() {
                this.imageData.data.set(this.data);
            }

            renderToCanvas(targetCanvas) {
                this.ctx.putImageData(this.imageData, 0, 0);
                targetCanvas.getContext('2d').drawImage(this.canvas, 0, 0);
            }
        }

        // ------------------------------------------------------------------
        // 2. Создание процедурной текстуры высокого разрешения + мипмапы
        // ------------------------------------------------------------------
        class MipmappedTexture {
            constructor(width, height, generateLevels = true) {
                this.width = width;
                this.height = height;
                this.mipmaps = [];   // массив ImageData / пиксельных массивов
                this.generateBaseTexture();
                if (generateLevels) this.buildMipmaps();
            }

            generateBaseTexture() {
                // создаём холст и рисуем яркую текстуру: сетка, градиент, узоры для проверки фильтрации
                const canvas = document.createElement('canvas');
                canvas.width = this.width;
                canvas.height = this.height;
                const ctx = canvas.getContext('2d');
                
                // фон: персиково-золотистый градиент
                const grad = ctx.createLinearGradient(0, 0, this.width, this.height);
                grad.addColorStop(0, '#ffb347');
                grad.addColorStop(0.5, '#ff6b6b');
                grad.addColorStop(1, '#4ecdc4');
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, this.width, this.height);
                
                // частый чёрно-белый шахматный узор (высокая частота)
                const cellSize = 16;
                ctx.beginPath();
                for (let i = 0; i < this.width; i += cellSize) {
                    for (let j = 0; j < this.height; j += cellSize) {
                        if ((Math.floor(i / cellSize) + Math.floor(j / cellSize)) % 2 === 0) {
                            ctx.fillStyle = '#000000aa';
                            ctx.fillRect(i, j, cellSize, cellSize);
                        } else {
                            ctx.fillStyle = '#ffffffaa';
                            ctx.fillRect(i, j, cellSize, cellSize);
                        }
                    }
                }
                
                // линии-сетка для оценки анизотропии
                ctx.beginPath();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#f0f0f0';
                for (let k = 0; k < this.width; k += 32) {
                    ctx.beginPath();
                    ctx.moveTo(k, 0);
                    ctx.lineTo(k, this.height);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(0, k);
                    ctx.lineTo(this.width, k);
                    ctx.stroke();
                }
                
                // надпись "CG" и круги для визуального контроля мипмапа
                ctx.font = `bold ${Math.floor(this.width * 0.12)}px "Segoe UI"`;
                ctx.fillStyle = '#2c3e66';
                ctx.shadowBlur = 0;
                ctx.fillText("3D", this.width*0.35, this.height*0.65);
                ctx.font = `bold ${Math.floor(this.width * 0.1)}px monospace`;
                ctx.fillStyle = '#ffd966';
                ctx.fillText("TEX", this.width*0.55, this.height*0.85);
                
                // дополнительные цветные точки
                for (let p = 0; p < 300; p++) {
                    ctx.fillStyle = `hsl(${Math.random() * 360}, 70%, 60%)`;
                    ctx.fillRect(Math.random() * this.width, Math.random() * this.height, 2, 2);
                }
                
                // сохраняем base уровень (ImageData)
                const imageData = ctx.getImageData(0, 0, this.width, this.height);
                this.mipmaps.push(imageData);
            }
            
            buildMipmaps() {
                // строим мип-уровни до 1x1 (упрощённо, box filter)
                let current = this.mipmaps[0];
                let w = this.width;
                let h = this.height;
                while (w > 1 && h > 1) {
                    const newW = Math.max(1, Math.floor(w / 2));
                    const newH = Math.max(1, Math.floor(h / 2));
                    const newData = new ImageData(newW, newH);
                    const srcData = current.data;
                    const dstData = newData.data;
                    
                    for (let y = 0; y < newH; y++) {
                        for (let x = 0; x < newW; x++) {
                            let sumR = 0, sumG = 0, sumB = 0, count = 0;
                            const srcX0 = x * 2;
                            const srcY0 = y * 2;
                            for (let dy = 0; dy < 2; dy++) {
                                for (let dx = 0; dx < 2; dx++) {
                                    const sx = srcX0 + dx;
                                    const sy = srcY0 + dy;
                                    if (sx < w && sy < h) {
                                        const idx = (sy * w + sx) * 4;
                                        sumR += srcData[idx];
                                        sumG += srcData[idx+1];
                                        sumB += srcData[idx+2];
                                        count++;
                                    }
                                }
                            }
                            const idxDst = (y * newW + x) * 4;
                            dstData[idxDst] = sumR / count;
                            dstData[idxDst+1] = sumG / count;
                            dstData[idxDst+2] = sumB / count;
                            dstData[idxDst+3] = 255;
                        }
                    }
                    this.mipmaps.push(newData);
                    current = newData;
                    w = newW;
                    h = newH;
                }
            }
            
            // билинейная фильтрация на конкретном мип-уровне
            sampleBilinear(level, u, v) {
                const mip = this.mipmaps[level];
                if (!mip) return { r: 128, g: 128, b: 128 };
                const w = mip.width;
                const h = mip.height;
                // clamp UV -> [0,1]
                let fu = u - Math.floor(u);
                let fv = v - Math.floor(v);
                let x = Math.floor(u * w) % w;
                let y = Math.floor(v * h) % h;
                if (x < 0) x = 0;
                if (y < 0) y = 0;
                if (x >= w) x = w-1;
                if (y >= h) y = h-1;
                const x1 = (x + 1) % w;
                const y1 = (y + 1) % h;
                
                const getTex = (xx, yy) => {
                    const idx = (yy * w + xx) * 4;
                    return { r: mip.data[idx], g: mip.data[idx+1], b: mip.data[idx+2] };
                };
                const c00 = getTex(x, y);
                const c10 = getTex(x1, y);
                const c01 = getTex(x, y1);
                const c11 = getTex(x1, y1);
                
                const r = (1-fu)*(1-fv)*c00.r + fu*(1-fv)*c10.r + (1-fu)*fv*c01.r + fu*fv*c11.r;
                const g = (1-fu)*(1-fv)*c00.g + fu*(1-fv)*c10.g + (1-fu)*fv*c01.g + fu*fv*c11.g;
                const b = (1-fu)*(1-fv)*c00.b + fu*(1-fv)*c10.b + (1-fu)*fv*c01.b + fu*fv*c11.b;
                return { r: Math.min(255,Math.max(0,r)), g: Math.min(255,Math.max(0,g)), b: Math.min(255,Math.max(0,b)) };
            }
            
            // выбор мип-уровня на основе грубой оценки производных (dx, dy)
            // упрощённый мипмаппинг: lambda = log2(max(scaleU, scaleV)) с ограничением
            estimateMipLevel(du_dx, dv_dx, du_dy, dv_dy) {
                const dxScale = Math.abs(du_dx) + Math.abs(dv_dx);
                const dyScale = Math.abs(du_dy) + Math.abs(dv_dy);
                let scale = Math.max(dxScale, dyScale) * 1.5;
                if (scale < 0.001) scale = 0.001;
                let level = Math.log2(scale) * 0.8;   // эмпирический коэффициент для наглядности
                level = Math.min(level, this.mipmaps.length - 1);
                level = Math.max(0, level);
                return Math.floor(level);
            }
            
            // итоговая выборка с билинейной фильтрацией и мипмаппингом (автоматический выбор уровня)
            sampleWithMipmap(u, v, du_dx, dv_dx, du_dy, dv_dy) {
                // нормализуем uv в диапазон [0, 1]
                let u_frac = u - Math.floor(u);
                let v_frac = v - Math.floor(v);
                let fu = u_frac;
                let fv = v_frac;
                
                const level = this.estimateMipLevel(du_dx, dv_dx, du_dy, dv_dy);
                const color0 = this.sampleBilinear(level, fu, fv);
                // для плавности можно было бы смешивать уровни, но по заданию "упрощенный мипмаппинг" — выбираем один уровень
                return color0;
            }
        }
        
        // ----------------------------------------------------------------
        // 3. 3D Треугольник с текстурированием, перспективно-корректная интерполяция
        // ----------------------------------------------------------------
        class TexturedTriangle {
            constructor(tex, vertices3D, uvCoords) {
                this.tex = tex;
                this.vertices3D = vertices3D;  // массив [{x,y,z}, ...]
                this.uvs = uvCoords;            // [{u,v}, ...]
            }
            
            // Проецирование 3D -> экран с учетом расстояния до камеры
            project(vertex, camX, camY, camZ, focalLength, centerX, centerY) {
                // vertex в мировых координатах, камера в (0,0, camZ)
                const xRel = vertex.x - camX;
                const yRel = vertex.y - camY;
                const zRel = vertex.z - camZ;   // глубина от камеры (zRel > 0)
                const invZ = 1.0 / (zRel + 0.001);
                const sx = (xRel * focalLength * invZ) + centerX;
                const sy = (yRel * focalLength * invZ) + centerY;
                return { sx, sy, invZ };
            }
            
            // Вспомогательная функция: edge function для barycentric
            static edge2D(a, b, c) {
                return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
            }
            
            // Главный растеризатор с перспективной коррекцией и мипмаппингом
            draw(pixelBuffer, mvpParams) {
                const { camX, camY, camZ, focalLength, centerX, centerY } = mvpParams;
                // 1. Проецируем вершины
                const proj = [];
                for (let i = 0; i < 3; i++) {
                    const p = this.project(this.vertices3D[i], camX, camY, camZ, focalLength, centerX, centerY);
                    proj.push({
                        x: p.sx,
                        y: p.sy,
                        invZ: p.invZ,
                        u: this.uvs[i].u,
                        v: this.uvs[i].v,
                        u_over_z: this.uvs[i].u * p.invZ,
                        v_over_z: this.uvs[i].v * p.invZ
                    });
                }
                
                // bounding box
                let minX = Math.max(0, Math.floor(Math.min(proj[0].x, proj[1].x, proj[2].x)));
                let maxX = Math.min(pixelBuffer.width-1, Math.ceil(Math.max(proj[0].x, proj[1].x, proj[2].x)));
                let minY = Math.max(0, Math.floor(Math.min(proj[0].y, proj[1].y, proj[2].y)));
                let maxY = Math.min(pixelBuffer.height-1, Math.ceil(Math.max(proj[0].y, proj[1].y, proj[2].y)));
                if (minX > maxX || minY > maxY) return;
                
                // Предрасчёт edge-функций для барицентрических координат
                const v0 = { x: proj[0].x, y: proj[0].y };
                const v1 = { x: proj[1].x, y: proj[1].y };
                const v2 = { x: proj[2].x, y: proj[2].y };
                const area = TexturedTriangle.edge2D(v0, v1, v2);
                if (Math.abs(area) < 1e-6) return;
                
                // Массив для построчного хранения UV (для вычисления производных под мипмап)
                // оптимизация: будем вычислять производные по горизонтали используя соседний пиксель
                
                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        const p = { x: x + 0.5, y: y + 0.5 };
                        const w0 = TexturedTriangle.edge2D(v1, v2, p);
                        const w1 = TexturedTriangle.edge2D(v2, v0, p);
                        const w2 = TexturedTriangle.edge2D(v0, v1, p);
                        if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
                            // барицентрические координаты (нормированные)
                            const alpha = w0 / area;
                            const beta  = w1 / area;
                            const gamma = w2 / area;
                            
                            // перспективно-корректная интерполяция  (1/w, u/w, v/w)
                            let invW = alpha * proj[0].invZ + beta * proj[1].invZ + gamma * proj[2].invZ;
                            let u_over_w = alpha * proj[0].u_over_z + beta * proj[1].u_over_z + gamma * proj[2].u_over_z;
                            let v_over_w = alpha * proj[0].v_over_z + beta * proj[1].v_over_z + gamma * proj[2].v_over_z;
                            if (invW < 0.0001) invW = 0.0001;
                            let finalU = u_over_w / invW;
                            let finalV = v_over_w / invW;
                            
                            // Нормализуем координаты текстуры в диапазон [0,1] (повторяем wrap)
                            let u_tex = finalU - Math.floor(finalU);
                            let v_tex = finalV - Math.floor(finalV);
                            
                            // ------------------------------------------------------------------
                            // Вычисление градиентов для мипмаппинга (упрощенно через соседние пиксели)
                            // Для каждого пикселя оцениваем du/dx, dv/dx, du/dy (используем конечные разности)
                            // в целях производительности делаем достаточно грубо, но наглядно
                            let du_dx = 0.01, dv_dx = 0.01, du_dy = 0.01, dv_dy = 0.01;
                            // смотрим пиксель справа (если в пределах треугольника)
                            if (x + 1 <= maxX) {
                                const pR = { x: x+1.5, y: y+0.5 };
                                const w0r = TexturedTriangle.edge2D(v1, v2, pR);
                                const w1r = TexturedTriangle.edge2D(v2, v0, pR);
                                const w2r = TexturedTriangle.edge2D(v0, v1, pR);
                                if (w0r >=0 && w1r >=0 && w2r >=0) {
                                    let invWr = (w0r/area)*proj[0].invZ + (w1r/area)*proj[1].invZ + (w2r/area)*proj[2].invZ;
                                    let uowr = (w0r/area)*proj[0].u_over_z + (w1r/area)*proj[1].u_over_z + (w2r/area)*proj[2].u_over_z;
                                    let vowr = (w0r/area)*proj[0].v_over_z + (w1r/area)*proj[1].v_over_z + (w2r/area)*proj[2].v_over_z;
                                    if(invWr>0.0001){
                                        let uR = uowr/invWr;
                                        let vR = vowr/invWr;
                                        du_dx = Math.abs(uR - finalU);
                                        dv_dx = Math.abs(vR - finalV);
                                    }
                                }
                            }
                            // смотрим пиксель снизу для du/dy
                            if (y + 1 <= maxY) {
                                const pD = { x: x+0.5, y: y+1.5 };
                                const w0d = TexturedTriangle.edge2D(v1, v2, pD);
                                const w1d = TexturedTriangle.edge2D(v2, v0, pD);
                                const w2d = TexturedTriangle.edge2D(v0, v1, pD);
                                if (w0d >=0 && w1d >=0 && w2d >=0) {
                                    let invWd = (w0d/area)*proj[0].invZ + (w1d/area)*proj[1].invZ + (w2d/area)*proj[2].invZ;
                                    let uowd = (w0d/area)*proj[0].u_over_z + (w1d/area)*proj[1].u_over_z + (w2d/area)*proj[2].u_over_z;
                                    let vowd = (w0d/area)*proj[0].v_over_z + (w1d/area)*proj[1].v_over_z + (w2d/area)*proj[2].v_over_z;
                                    if(invWd>0.0001){
                                        let uD = uowd/invWd;
                                        let vD = vowd/invWd;
                                        du_dy = Math.abs(uD - finalU);
                                        dv_dy = Math.abs(vD - finalV);
                                    }
                                }
                            }
                            
                            // финальный семплинг с мипмаппингом и билинейной фильтрацией
                            const texColor = this.tex.sampleWithMipmap(u_tex, v_tex, du_dx, dv_dx, du_dy, dv_dy);
                            pixelBuffer.setPixel(x, y, texColor.r, texColor.g, texColor.b, 255);
                        }
                    }
                }
            }
        }
        
        // ----------------------------------------------------------------
        // 4. Инициализация сцены, вращение, анимация
        // ----------------------------------------------------------------
        const canvas = document.getElementById('textureCanvas');
        const pixelBuffer = new PixelBuffer(640, 640);
        
        // Создаем текстуру с мипмапами (размер 512x512 для качества)
        const mainTexture = new MipmappedTexture(512, 512, true);
        
        // Вершины треугольника в 3D (мировые координаты, центр в начале)
        // Треугольник с хорошей площадью и UV-разверткой
        const verts3D = [
            { x: -1.2, y: -0.9, z: 2.2 },   // v0 левый нижний
            { x:  1.2, y: -0.9, z: 2.2 },   // v1 правый нижний
            { x:  0.0, y:  1.2, z: 2.0 }    // v2 верхний
        ];
        const uvCoords = [
            { u: 0.05, v: 0.95 },
            { u: 0.95, v: 0.95 },
            { u: 0.5,  v: 0.05 }
        ];
        
        const texturedTri = new TexturedTriangle(mainTexture, verts3D, uvCoords);
        
        // параметры камеры и проекции
        let angleY = 0;
        let angleX = 0.4;
        let angleZ = 0;
        
        // вспомогательная функция вращения точек вокруг начала координат
        function rotatePoint(p, rotY, rotX, rotZ) {
            let x = p.x, y = p.y, z = p.z;
            // Rot Y
            let cosY = Math.cos(rotY);
            let sinY = Math.sin(rotY);
            let x1 = x * cosY + z * sinY;
            let z1 = -x * sinY + z * cosY;
            let y1 = y;
            // Rot X
            let cosX = Math.cos(rotX);
            let sinX = Math.sin(rotX);
            let y2 = y1 * cosX - z1 * sinX;
            let z2 = y1 * sinX + z1 * cosX;
            let x2 = x1;
            // Rot Z (minor)
            let cosZ = Math.cos(rotZ);
            let sinZ = Math.sin(rotZ);
            let xf = x2 * cosZ - y2 * sinZ;
            let yf = x2 * sinZ + y2 * cosZ;
            let zf = z2;
            return { x: xf, y: yf, z: zf };
        }
        
        // Параметры перспективы
        const focalLength = 480;
        const centerX = 320;
        const centerY = 320;
        const cameraDistance = 4.5;
        
        let lastTimestamp = 0;
        let frameCount = 0;
        let fps = 60;
        
        function animate() {
            const now = performance.now();
            if (lastTimestamp !== 0) {
                const delta = Math.min(100, now - lastTimestamp);
                if (delta > 0) {
                    const currentFps = 1000 / delta;
                    fps = fps * 0.9 + currentFps * 0.1;
                    document.getElementById('fpsCounter').innerHTML = `⚡ FPS: ${Math.round(fps)}`;
                }
            }
            lastTimestamp = now;
            
            // обновляем углы вращения
            angleY += 0.008;
            angleX = 0.3 + Math.sin(now * 0.0012) * 0.2;
            angleZ += 0.003;
            
            // трансформируем вершины треугольника
            const transformedVerts = verts3D.map(v => rotatePoint(v, angleY, angleX, angleZ));
            
            // создаём временный треугольник с преобразованными вершинами (без изменения исходного)
            const triInstance = new TexturedTriangle(mainTexture, transformedVerts, uvCoords);
            
            // очистка буфера (тёмный фон)
            pixelBuffer.clear(12, 14, 22, 255);
            
            // рисуем текстурированный треугольник
            triInstance.draw(pixelBuffer, {
                camX: 0, camY: 0, camZ: -cameraDistance,
                focalLength: focalLength,
                centerX: centerX,
                centerY: centerY
            });
            
            // добавим простую "подсветку" границ для эстетики (тонкий контур), но это не обязательно
            pixelBuffer.syncFromData();
            pixelBuffer.renderToCanvas(canvas);
            
            requestAnimationFrame(animate);
        }
        
        // сброс анимации (обновляет угол для статики)
        document.getElementById('resetMipBtn').addEventListener('click', () => {
            angleY = 0;
            angleX = 0.3;
            angleZ = 0;
            // небольшая обратная связь
            const fpsDiv = document.getElementById('fpsCounter');
            fpsDiv.style.opacity = '0.7';
            setTimeout(() => fpsDiv.style.opacity = '1', 200);
        });
        
        // Запуск анимации
        animate();
        
        // Вывод в консоль информации о мипмаппинге
        console.log(`Мипмапы созданы: ${mainTexture.mipmaps.length} уровней`);
        console.log(`Перспективно-корректный рендеринг + билинейная фильтрация активны`);
    })();