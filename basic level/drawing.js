    // --------------------------------------------------------------
    // 1. PIXEL BUFFER (работа с пикселями, ImageData)
    // --------------------------------------------------------------
    class PixelBuffer {
        constructor(width, height) {
            this.width = width;
            this.height = height;
            this.canvas = document.createElement('canvas');
            this.canvas.width = width;
            this.canvas.height = height;
            this.ctx = this.canvas.getContext('2d');
            this.imageData = this.ctx.createImageData(width, height);
            this.data = this.imageData.data;   // Uint8ClampedArray
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

        clear(r=255, g=255, b=255, a=255) {
            for (let i = 0; i < this.data.length; i += 4) {
                this.data[i] = r;
                this.data[i+1] = g;
                this.data[i+2] = b;
                this.data[i+3] = a;
            }
        }

        // Вспомогательная заливка прямоугольника для отрисовки начального состояния
        fillRect(x, y, w, h, r, g, b, a=255) {
            for (let iy = y; iy < y+h; iy++) {
                for (let ix = x; ix < x+w; ix++) {
                    this.setPixel(ix, iy, r, g, b, a);
                }
            }
        }

        drawOutlineRect(x1, y1, x2, y2, thickness, r, g, b) {
            // верхняя и нижняя границы
            for (let i = 0; i < thickness; i++) {
                for (let x = x1; x <= x2; x++) {
                    if (y1+i < this.height) this.setPixel(x, y1+i, r, g, b);
                    if (y2-i >= 0) this.setPixel(x, y2-i, r, g, b);
                }
                for (let y = y1; y <= y2; y++) {
                    if (x1+i < this.width) this.setPixel(x1+i, y, r, g, b);
                    if (x2-i >= 0) this.setPixel(x2-i, y, r, g, b);
                }
            }
        }

        // отрисовка содержимого на canvas
        renderToCanvas(targetCanvas) {
            this.ctx.putImageData(this.imageData, 0, 0);
            targetCanvas.getContext('2d').drawImage(this.canvas, 0, 0);
        }

        // синхронизация данных после прямых манипуляций с буфером
        syncFromData() {
            this.imageData.data.set(this.data);
        }
    }

    // --------------------------------------------------------------
    // 2. Утилиты: цветовое расстояние (евклидово)
    // --------------------------------------------------------------
    function colorDistance(c1, c2) {
        const dr = c1.r - c2.r;
        const dg = c1.g - c2.g;
        const db = c1.b - c2.b;
        return Math.sqrt(dr*dr + dg*dg + db*db);
    }

    function isSimilar(pixel, targetColor, tolerance) {
        if (!pixel) return false;
        const dist = colorDistance(pixel, targetColor);
        return dist <= tolerance;
    }

    // --------------------------------------------------------------
    // 3. STACK FLOOD FILL (итеративный, стек/очередь)
    //    поддержка 4-связности / 8-связности + tolerance
    // --------------------------------------------------------------
    function floodFillStack(buffer, startX, startY, fillColorRGB, tolerance, connectivity4) {
        const startPixel = buffer.getPixel(startX, startY);
        if (!startPixel) return 0;

        const targetColor = { r: startPixel.r, g: startPixel.g, b: startPixel.b };
        const fillR = fillColorRGB[0], fillG = fillColorRGB[1], fillB = fillColorRGB[2];

        // если начальная точка уже совпадает с цветом заливки (в пределах допуска) – ничего не делаем
        if (isSimilar(targetColor, { r: fillR, g: fillG, b: fillB }, tolerance)) return 0;

        const stack = [[startX, startY]];
        const neighbors = connectivity4 
            ? [[0,1],[1,0],[0,-1],[-1,0]]
            : [[0,1],[1,0],[0,-1],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];
        
        let pixelsFilled = 0;
        const w = buffer.width, h = buffer.height;

        while (stack.length) {
            const [cx, cy] = stack.pop();
            const pix = buffer.getPixel(cx, cy);
            if (!pix) continue;
            if (isSimilar(pix, targetColor, tolerance)) {
                buffer.setPixel(cx, cy, fillR, fillG, fillB, 255);
                pixelsFilled++;
                for (const [dx, dy] of neighbors) {
                    const nx = cx + dx, ny = cy + dy;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        // оптимизация: не проверяем, был ли уже изменен? но мы будем проверять по цвету
                        // всё равно при попадании в стек проверим на похожесть с targetColor,
                        // т.к. если уже залито, то цвет не совпадает с target
                        stack.push([nx, ny]);
                    }
                }
            }
        }
        buffer.syncFromData();
        return pixelsFilled;
    }

    // --------------------------------------------------------------
    // 4. SCANLINE FILL (оптимизированная версия, итеративный стек отрезков)
    //    4-связность, поддержка tolerance
    // --------------------------------------------------------------
    function floodFillScanline(buffer, startX, startY, fillColorRGB, tolerance) {
        const startPixel = buffer.getPixel(startX, startY);
        if (!startPixel) return 0;
        const targetColor = { r: startPixel.r, g: startPixel.g, b: startPixel.b };
        const fillR = fillColorRGB[0], fillG = fillColorRGB[1], fillB = fillColorRGB[2];
        
        if (isSimilar(targetColor, { r: fillR, g: fillG, b: fillB }, tolerance)) return 0;

        const stack = [{ y: startY, left: startX, right: startX }];
        let pixelsFilled = 0;
        const w = buffer.width, h = buffer.height;

        while (stack.length) {
            const seg = stack.pop();
            let y = seg.y;
            let lx = seg.left;
            let rx = seg.right;

            // Находим левую границу отрезка на строке y
            while (lx - 1 >= 0) {
                const leftPixel = buffer.getPixel(lx - 1, y);
                if (leftPixel && isSimilar(leftPixel, targetColor, tolerance)) {
                    lx--;
                } else break;
            }
            // Находим правую границу
            while (rx + 1 < w) {
                const rightPixel = buffer.getPixel(rx + 1, y);
                if (rightPixel && isSimilar(rightPixel, targetColor, tolerance)) {
                    rx++;
                } else break;
            }

            // Закрашиваем горизонтальный отрезок [lx, rx]
            for (let x = lx; x <= rx; x++) {
                const curr = buffer.getPixel(x, y);
                if (curr && isSimilar(curr, targetColor, tolerance)) {
                    buffer.setPixel(x, y, fillR, fillG, fillB, 255);
                    pixelsFilled++;
                }
            }

            // Проверяем строку выше (y-1) и ниже (y+1) на новые сегменты
            for (let dy of [-1, 1]) {
                const ny = y + dy;
                if (ny < 0 || ny >= h) continue;
                let spanActive = false;
                let spanStart = -1;
                // проходим по диапазону [lx, rx] и немного шире для захвата смежных сегментов
                let scanX = lx;
                while (scanX <= rx) {
                    const pixelAbove = buffer.getPixel(scanX, ny);
                    const isInside = (pixelAbove && isSimilar(pixelAbove, targetColor, tolerance));
                    if (isInside && !spanActive) {
                        spanActive = true;
                        spanStart = scanX;
                    } 
                    if ((!isInside || scanX === rx) && spanActive) {
                        let endX = (isInside && scanX === rx) ? rx : scanX - 1;
                        stack.push({ y: ny, left: spanStart, right: endX });
                        spanActive = false;
                        // небольшой прыжок для избежания дублирования
                        scanX = endX + 1;
                        continue;
                    }
                    scanX++;
                }
                // дополнительно: обработать случай если активный span в конце
                if (spanActive && spanStart !== -1) {
                    stack.push({ y: ny, left: spanStart, right: rx });
                }
            }
        }
        buffer.syncFromData();
        return pixelsFilled;
    }

    // --------------------------------------------------------------
    // 5. ИНИЦИАЛИЗАЦИЯ ГЛАВНОГО КАНВАСА с красивым тестовым полем
    //    создаем замкнутую область с препятствиями, границами
    // --------------------------------------------------------------
    function initMainPattern(buffer) {
        buffer.clear(245, 245, 250, 255);  // светлый фон
        
        // 1) внешняя рамка (черная) - граница для эстетики
        buffer.drawOutlineRect(2, 2, buffer.width-3, buffer.height-3, 2, 40, 40, 45);
        
        // 2) основная внутренняя заливаемая область: светло-персиковая
        //    но создадим несколько "островов" разного цвета, чтобы flood fill обходил препятствия
        //    заливка будет работать только внутри однородных участков
        for (let y = 50; y < 450; y++) {
            for (let x = 50; x < 450; x++) {
                if (buffer.getPixel(x, y)?.r === 40 && buffer.getPixel(x, y)?.g === 40) continue;
                buffer.setPixel(x, y, 235, 210, 170, 255);   // base теплый бежевый
            }
        }
        
        // Рисуем препятствия: 3 круга, пару прямоугольников с другим цветом (серо-синий)
        function drawObstacleRect(x1,y1,x2,y2, rC,gC,bC) {
            for (let iy = y1; iy <= y2; iy++) {
                for (let ix = x1; ix <= x2; ix++) {
                    if (ix>=0 && ix<buffer.width && iy>=0 && iy<buffer.height)
                        buffer.setPixel(ix, iy, rC, gC, bC, 255);
                }
            }
        }
        function drawCircle(centerX, centerY, radius, rC,gC,bC) {
            for (let y = -radius; y <= radius; y++) {
                for (let x = -radius; x <= radius; x++) {
                    if (x*x + y*y <= radius*radius) {
                        const cx = centerX + x;
                        const cy = centerY + y;
                        if (cx>=0 && cx<buffer.width && cy>=0 && cy<buffer.height)
                            buffer.setPixel(cx, cy, rC, gC, bC, 255);
                    }
                }
            }
        }
        
        // препятствия: (серо-голубые острова)
        drawObstacleRect(110, 120, 180, 190, 90, 130, 150);
        drawObstacleRect(340, 350, 410, 400, 80, 110, 140);
        drawCircle(280, 280, 35, 110, 100, 120);
        drawCircle(150, 380, 28, 95, 85, 115);
        drawObstacleRect(400, 80, 450, 140, 100, 115, 135);
        
        // Добавим еще "чернильные" точки для сложности: маленькие красные точки не мешают основной заливке с допуском
        for (let i = 0; i < 180; i++) {
            const rx = 60 + Math.random() * 380;
            const ry = 60 + Math.random() * 380;
            if (buffer.getPixel(rx, ry)?.r === 235) {
                buffer.setPixel(rx, ry, 200, 90, 90, 255);
            }
        }
        
        // границы дополнительно подчеркнем
        buffer.drawOutlineRect(48, 48, 452, 452, 1, 60, 60, 70);
        buffer.syncFromData();
    }

    // --------------------------------------------------------------
    // 6. СОЗДАНИЕ ТЕСТОВОЙ ОБЛАСТИ 100x100 для бенчмарка
    //    замкнутый контур, внутренность монотонного цвета с вариацией (для tolerance)
    // --------------------------------------------------------------
    function createTestBuffer100x100() {
        const buf = new PixelBuffer(100, 100);
        // фон темно-серый граничный контур
        buf.clear(210, 220, 230, 255);
        // рисуем сплошную область : внутренний прямоугольник со "связанным цветом" 
        // оранжево-коричневая область, но с небольшим шумом, чтобы tolerance имел эффект
        for (let y = 10; y < 90; y++) {
            for (let x = 10; x < 90; x++) {
                let variation = (Math.sin(x * 0.4) * 5 + Math.cos(y * 0.5) * 4) | 0;
                let rColor = 180 + variation;
                let gColor = 110 + (variation/2);
                let bColor = 70;
                buf.setPixel(x, y, rColor, gColor, bColor, 255);
            }
        }
        // граница черная (чтобы ограничить заливку)
        for (let i = 0; i < 100; i++) {
            buf.setPixel(i, 8, 0,0,0,255);
            buf.setPixel(i, 91, 0,0,0,255);
            buf.setPixel(8, i, 0,0,0,255);
            buf.setPixel(91, i, 0,0,0,255);
        }
        // стенки утолщаем
        for (let i = 0; i < 100; i++) {
            if(i<9 || i>90) continue;
            buf.setPixel(9,i,0,0,0,255);
            buf.setPixel(90,i,0,0,0,255);
        }
        buf.syncFromData();
        return buf;
    }

    // --------------------------------------------------------------
    // 7. ГЛАВНЫЙ UI, ОБРАБОТЧИКИ, ПРОИЗВОДИТЕЛЬНОСТЬ
    // --------------------------------------------------------------
    const canvas = document.getElementById('mainCanvas');
    let mainBuffer = new PixelBuffer(500, 500);
    initMainPattern(mainBuffer);
    mainBuffer.renderToCanvas(canvas);
    
    // получить активные параметры
    function getFillColorRGB() {
        const hex = document.getElementById('fillColorPicker').value;
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        return [r, g, b];
    }
    
    function getTolerance() {
        return parseInt(document.getElementById('toleranceSlider').value);
    }
    
    function getConnectivity4() {
        const conn = document.querySelector('input[name="connectivity"]:checked').value;
        return conn === '4';
    }
    
    function getSelectedAlgorithm() {
        return document.querySelector('input[name="algorithm"]:checked').value;
    }
    
    // ОБЩАЯ функция заливки на основном буфере (с таймингом и визуализацией)
    function performFloodFillOnMain(clickX, clickY) {
        const algo = getSelectedAlgorithm();
        const tolerance = getTolerance();
        const fillRGB = getFillColorRGB();
        const connectivity4 = getConnectivity4();
        
        let startTime = performance.now();
        let pixelsChanged = 0;
        
        if (algo === 'stack') {
            pixelsChanged = floodFillStack(mainBuffer, clickX, clickY, fillRGB, tolerance, connectivity4);
        } else { // scanline
            pixelsChanged = floodFillScanline(mainBuffer, clickX, clickY, fillRGB, tolerance);
        }
        const elapsed = performance.now() - startTime;
        mainBuffer.renderToCanvas(canvas);
        
        // всплывающее уведомление о производительности
        const benchDiv = document.getElementById('benchPanel');
        const msg = document.createElement('div');
        msg.style.fontSize = '0.7rem';
        msg.style.marginTop = '6px';
        msg.style.opacity = '0.8';
        msg.innerText = `🔔 Заливка: ${pixelsChanged} пикселей | ${elapsed.toFixed(2)} ms`;
        const oldMsg = document.getElementById('dynamicToast');
        if(oldMsg) oldMsg.remove();
        msg.id = 'dynamicToast';
        benchDiv.appendChild(msg);
        setTimeout(() => msg.style.opacity = '0', 2000);
        setTimeout(() => msg.remove(), 2500);
    }
    
    // БЕНЧМАРК: тест на 100x100 области сравнение всех трёх методов (stack4, stack8, scanline)
    async function runBenchmark() {
        const tolerance = getTolerance();
        const fillRGB = getFillColorRGB();
        const testBufferOriginal = createTestBuffer100x100();
        
        // helper для клонирования буфера
        function cloneBuffer(src) {
            const clone = new PixelBuffer(src.width, src.height);
            for (let i=0; i<src.data.length; i++) clone.data[i] = src.data[i];
            clone.syncFromData();
            return clone;
        }
        
        // функция замера
        function measure(algorithmType, useConnectivity4 = true) {
            const testBuf = cloneBuffer(testBufferOriginal);
            const startX = 50, startY = 50; // всегда внутри области
            const startPerf = performance.now();
            let filled = 0;
            if (algorithmType === 'stack4') {
                filled = floodFillStack(testBuf, startX, startY, fillRGB, tolerance, true);
            } else if (algorithmType === 'stack8') {
                filled = floodFillStack(testBuf, startX, startY, fillRGB, tolerance, false);
            } else if (algorithmType === 'scanline') {
                filled = floodFillScanline(testBuf, startX, startY, fillRGB, tolerance);
            }
            const elapsed = performance.now() - startPerf;
            return { time: elapsed, pixels: filled };
        }
        
        // прогон нескольких повторов для стабильности (по 3 замера, среднее)
        const runs = 3;
        let sumStack4 = 0, sumStack8 = 0, sumScan = 0;
        for (let i = 0; i < runs; i++) {
            sumStack4 += measure('stack4').time;
            sumStack8 += measure('stack8').time;
            sumScan += measure('scanline').time;
        }
        const avgStack4 = (sumStack4 / runs).toFixed(2);
        const avgStack8 = (sumStack8 / runs).toFixed(2);
        const avgScan = (sumScan / runs).toFixed(2);
        
        document.getElementById('benchStack4').innerHTML = `🔹 Stack 4‑связность: ${avgStack4} ms (сред.)`;
        document.getElementById('benchStack8').innerHTML = `🔸 Stack 8‑связность: ${avgStack8} ms (сред.)`;
        document.getElementById('benchScanline').innerHTML = `✨ Scanline Fill: ${avgScan} ms (сред.)`;
        document.getElementById('benchNote').innerHTML = `✅ Тест на 100x100 (tolerance=${tolerance}) | заливка ~ ${measure('stack4').pixels} пикс.`;
    }
    
    // обработчик клика по canvas
    canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        let mouseX = (e.clientX - rect.left) * scaleX;
        let mouseY = (e.clientY - rect.top) * scaleY;
        mouseX = Math.floor(Math.min(499, Math.max(0, mouseX)));
        mouseY = Math.floor(Math.min(499, Math.max(0, mouseY)));
        performFloodFillOnMain(mouseX, mouseY);
    });
    
    // сброс рисунка
    document.getElementById('resetBtn').addEventListener('click', () => {
        initMainPattern(mainBuffer);
        mainBuffer.renderToCanvas(canvas);
    });
    
    document.getElementById('benchmarkBtn').addEventListener('click', () => {
        runBenchmark();
    });
    
    // отображение значения tolerance
    const toleranceSlider = document.getElementById('toleranceSlider');
    const toleranceSpan = document.getElementById('toleranceValue');
    toleranceSlider.addEventListener('input', () => {
        toleranceSpan.innerText = toleranceSlider.value;
    });
    
    // синхронизация ползунка
    toleranceSpan.innerText = toleranceSlider.value;
    
    // подсказка интерфейса
    console.log('Ready: Flood Fill с 4/8-связностью и Scanline');