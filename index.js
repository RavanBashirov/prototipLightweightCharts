// Block 1: Импорты библиотек и модулей
// Этот блок импортирует необходимые зависимости для React, charting, drag-and-drop и resizable компонентов.
// Он является первым и ссылается на все последующие блоки, предоставляя инструменты для их работы.
// Выполняется на этапе инициализации скрипта.

import React from 'react'; // Импорт React для создания компонентов
import ReactDOM from 'react-dom/client'; // Импорт ReactDOM для рендеринга в DOM
import { createChart } from 'lightweight-charts'; // Импорт функции для создания чарта из lightweight-charts
import { DndProvider, useDrag, useDrop } from 'react-dnd'; // Импорт провайдера и хуков для drag-and-drop
import { HTML5Backend } from 'react-dnd-html5-backend'; // Импорт backend для HTML5 drag-and-drop
import { Resizable } from 'react-resizable'; // Импорт компонента для изменения размера
import 'react-resizable/css/styles.css'; // Импорт стилей для resizable

// Block 2: Константы приложения
// Определяет константы для типа чарта, высоты тулбара и конфигурации данных.
// Ссылается на Block 3 и Block 4 для генерации и агрегации данных.
// Выполняется после Block 1, используется в Block 10 и Block 11.

const CHART_TYPE = 'chart'; // Константа для типа элемента в drag-and-drop
const TOOLBAR_HEIGHT = 30; // Высота тулбара в пикселях

// Configuration constants
const START_SEED = 12345; // Начальное зерно для генератора случайных чисел
const START_LAST_CLOSE = 100; // Начальное значение закрытия для свечей
const START_TIME = new Date('2020-01-01').getTime() / 1000; // Начальное время в секундах Unix
const INTERVAL = 3600; // Интервал между свечами в секундах (1 час)
const TOTAL_CANDLES = 10000000; // Общее количество свечей (10 млн)
const CHUNK_SIZE = 500000; // Размер чанка для загрузки (500k)
const MAX_VISIBLE_BARS = 1000; // Максимум видимых баров без агрегации
const BUFFER_BARS = 10000; // Буфер баров для предзагрузки при панорамировании
const AGGREGATION_FACTOR_BASE = 1; // Базовый фактор агрегации
const MAX_RAW_SIZE = CHUNK_SIZE * 20; // Максимальный размер сырых данных в памяти

// Block 3: Функция fetchCandles
// Симулирует fetching свечей с бэкенда, генерируя детерминированные случайные OHLC данные.
// Ссылается на Block 2 для констант, используется в Block 9.
// Выполняется по запросу из Block 9.

function fetchCandles(offset, limit) { // Функция для fetching свечей по offset и limit
  console.log(`[fetchCandles] Starting fetch: offset=${offset}, limit=${limit}`); // Лог старта fetching
  // Limit to total candles
  const numCandles = Math.min(limit, TOTAL_CANDLES - offset); // Вычисление количества свечей для fetching
  if (numCandles <= 0) { // Проверка на отсутствие свечей
    console.log(`[fetchCandles] No candles to fetch: numCandles=${numCandles}`); // Лог отсутствия свечей
    return []; // Возврат пустого массива
  }

  // Seeded random generator (Mulberry32)
  let state = (START_SEED + offset) >>> 0; // Инициализация состояния генератора на основе offset
  const rand = () => { // Функция генератора случайных чисел
    state |= 0; // Обеспечение целочисленности
    state = (state + 0x6D2B79F5) | 0; // Обновление состояния
    let t = Math.imul(state ^ (state >>> 15), state | 1); // Вычисление промежуточного значения
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); // Дополнительное XOR и imul
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; // Нормализация к [0,1)
  };

  const data = []; // Массив для хранения свечей
  let lastClose = START_LAST_CLOSE + rand() * 10; // Инициализация последнего закрытия
  for (let i = 0; i < numCandles; i++) { // Цикл по количеству свечей
    const time = START_TIME + (offset + i) * INTERVAL; // Вычисление времени свечи
    const open = lastClose; // Open равен предыдущему close
    const high = open + rand() * 10; // High: open + случайное
    const low = open - rand() * 10; // Low: open - случайное
    const close = open + (rand() - 0.5) * 5; // Close: open + случайное отклонение
    data.push({ // Добавление свечи в data
      time, // Время
      open, // Open
      high: Math.max(high, open, close), // Корректировка high на максимум
      low: Math.min(low, open, close), // Корректировка low на минимум
      close, // Close
    });
    lastClose = close; // Обновление lastClose
  }
  console.log(`[fetchCandles] Fetched ${data.length} candles`); // Лог количества fetched свечей
  return data; // Возврат данных
}

// Block 4: Функция aggregateCandles
// Агрегирует свечи по фактору, группируя OHLC.
// Ссылается на Block 2, используется в Block 10 и Block 8.
// Выполняется при обновлении данных в Block 8.

function aggregateCandles(candles, factor) { // Функция агрегации свечей по factor
  console.log(`[aggregateCandles] Aggregating: candles.length=${candles.length}, factor=${factor}`); // Лог старта агрегации
  if (factor <= 1) return candles; // Если factor <=1, возврат исходных

  const aggregated = []; // Массив для агрегированных свечей
  const length = candles.length; // Длина исходного массива
  for (let i = 0; i < length; i += factor) { // Цикл с шагом factor
    const end = Math.min(i + factor, length); // Конец группы
    if (end - i < 1) break; // Если группа пустая, break

    const open = candles[i].open; // Open первой свечи
    const close = candles[end - 1].close; // Close последней
    let high = -Infinity; // Инициализация high
    let low = Infinity; // Инициализация low
    for (let j = i; j < end; j++) { // Цикл по группе
      high = Math.max(high, candles[j].high); // Обновление high
      low = Math.min(low, candles[j].low); // Обновление low
    }
    const time = candles[i].time; // Time первой свечи

    aggregated.push({ time, open, high, low, close }); // Добавление агрегированной свечи
  }
  console.log(`[aggregateCandles] Aggregated to ${aggregated.length} candles`); // Лог количества агрегированных
  return aggregated; // Возврат агрегированных данных
}

// Block 5: Компонент DraggableResizableChart
// Основной компонент для draggable/resizable чарта с аннотациями.
// Ссылается на Block 1-4,6-10, используется в Block 15.
// Выполняется при рендеринге в Block 15.

const DraggableResizableChart = ({ id, left, top, width, height, annotations, moveChart, resizeChart, updateAnnotations }) => { // Компонент с пропсами
  const chartRef = React.useRef(null); // Ref для контейнера чарта
  const canvasRef = React.useRef(null); // Ref для canvas аннотаций
  const [currentTool, setCurrentTool] = React.useState(null); // State для текущего инструмента
  const [history, setHistory] = React.useState([annotations]); // State для истории аннотаций
  const [historyIndex, setHistoryIndex] = React.useState(0); // State для индекса истории
  const chart = React.useRef(null); // Ref для инстанса чарта
  const candleSeries = React.useRef(null); // Ref для серии свечей
  const lineSeries = React.useRef(null); // Ref для линии
  const startPoint = React.useRef(null); // Ref для стартовой точки рисования
  const [currentWidth, setCurrentWidth] = React.useState(width); // State для текущей ширины
  const [currentHeight, setCurrentHeight] = React.useState(height); // State для текущей высоты
  const dataCache = React.useRef(new Map()); // Ref для кэша чанков данных
  const currentRawData = React.useRef([]); // Ref для текущих сырых данных
  const currentMinIndex = React.useRef(0); // Ref для мин индекса сырых данных
  const currentMaxIndex = React.useRef(0); // Ref для макс индекса сырых данных
  const lastCall = React.useRef(0); // Ref для времени последнего вызова

// Block 6: useEffect для обновления размеров
// Обновляет state ширины и высоты при изменении пропсов.
// Ссылается на Block 5, выполняется после рендера при изменении width/height.

  React.useEffect(() => { // Effect для обновления размеров
    console.log(`[DraggableResizableChart] Updating dimensions: id=${id}, width=${width}, height=${height}`); // Лог обновления
    setCurrentWidth(width); // Установка текущей ширины
    setCurrentHeight(height); // Установка текущей высоты
  }, [width, height]); // Зависимости: width, height

// Block 7: useEffect для настройки чарта
// Создает чарт, серии, загружает начальные данные, настраивает timescale.
// Ссылается на Block 2,4,8,9,10, выполняется при изменении размеров.

  React.useEffect(() => { // Effect для настройки чарта
    console.log(`[DraggableResizableChart] Setting up chart: id=${id}, currentWidth=${currentWidth}, currentHeight=${currentHeight}`); // Лог настройки
    if (chartRef.current) { // Если ref существует
      chart.current = createChart(chartRef.current, { // Создание чарта
        width: currentWidth, // Ширина
        height: currentHeight - TOOLBAR_HEIGHT, // Высота минус тулбар
        timeScale: {  // Опции timescale
          fixLeftEdge: false,  // Не фиксировать левый край
          fixRightEdge: false,  // Не фиксировать правый край
          timeVisible: true,  // Показывать время
          secondsVisible: false, // Не показывать секунды
          lockVisibleTimeRangeOnResize: true, // Лок диапазона при ресайзе
          rightOffset: 0 // Отступ справа
        }, // Changed: Set fixRightEdge to false to allow panning right into empty space without artifacts and cyclic rendering issues
      });
      console.log(`[DraggableResizableChart] Chart created`); // Лог создания чарта
      candleSeries.current = chart.current.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350' }); // Добавление серии свечей
      console.log(`[DraggableResizableChart] Candlestick series added`); // Лог добавления серии
      lineSeries.current = chart.current.addLineSeries({ color: '#FF0000', lineWidth: 2 }); // Добавление линии
      console.log(`[DraggableResizableChart] Line series added`); // Лог добавления линии

      // Initial load: last chunk for recent data
      const initialOffset = Math.max(0, TOTAL_CANDLES - CHUNK_SIZE - 2 * BUFFER_BARS); // Вычисление начального offset
      console.log(`[DraggableResizableChart] Initial load: offset=${initialOffset}, limit=${CHUNK_SIZE + 2 * BUFFER_BARS}`); // Лог начальной загрузки
      const initialData = loadData(initialOffset, CHUNK_SIZE + 2 * BUFFER_BARS); // Загрузка начальных данных
      currentRawData.current = initialData; // Установка сырых данных
      currentMinIndex.current = initialOffset; // Установка мин индекса
      currentMaxIndex.current = initialOffset + initialData.length - 1; // Установка макс индекса
      console.log(`[DraggableResizableChart] Initial data loaded: length=${initialData.length}, minIndex=${currentMinIndex.current}, maxIndex=${currentMaxIndex.current}`); // Лог загрузки
      const aggregatedData = aggregateCandles(initialData, 1); // Агрегация без фактора
      updateChartData(aggregatedData); // Обновление данных чарта
      const last100 = aggregatedData.slice(-100); // Последние 100 баров
      console.log(`[DraggableResizableChart] Setting initial visible range: from=${last100[0]?.time}, to=${last100[last100.length - 1]?.time}`); // Лог установки диапазона
      const timeScale = chart.current.timeScale(); // Получение timescale
      timeScale.subscribeVisibleTimeRangeChange(handleRangeChange); // Подписка на изменение диапазона
      chart.current.timeScale().setVisibleRange({ // Установка видимого диапазона
        from: last100[0].time, // От
        to: last100[last100.length - 1].time, // До
      });

      return () => { // Cleanup
        console.log(`[DraggableResizableChart] Cleaning up chart: id=${id}`); // Лог cleanup
        timeScale.unsubscribeVisibleTimeRangeChange(handleRangeChange); // Отписка
        chart.current.remove(); // Удаление чарта
      };
    }
  }, [currentWidth, currentHeight]); // Зависимости: размеры

// Block 8: Функция updateChartData
// Обновляет данные серий чарта и рисует аннотации.
// Ссылается на Block 5, используется в Block 7 и Block 8 (сам на себя через drawAnnotations).

  const updateChartData = (data) => { // Функция обновления данных чарта
    console.log(`[updateChartData] Updating chart data: length=${data.length}`); // Лог обновления
    candleSeries.current.setData(data); // Установка данных свечей
    lineSeries.current.setData(data.map(d => ({ time: d.time, value: d.close + 10 }))); // Установка данных линии
    drawAnnotations(); // Рисование аннотаций
  };

// Block 9: Функция handleRangeChange
// Троттлинг обработчика изменения видимого диапазона.
// Ссылается на Block 8, используется в Block 7.

  const handleRangeChange = () => { // Обработчик изменения диапазона
    const now = performance.now(); // Текущее время
    console.log(`[handleRangeChange] Range change triggered: now=${now}, lastCall=${lastCall.current}`); // Лог триггера
    if (now - lastCall.current < 50) { // Троттлинг 50ms
      console.log(`[handleRangeChange] Throttled: skipping`); // Лог троттлинга
      return; // Пропуск
    }
    lastCall.current = now; // Обновление lastCall
    updateVisibleData(); // Вызов обновления видимых данных
  };

// Block 10: Функция updateVisibleData
// Обновляет видимые данные на основе диапазона, с агрегацией и загрузкой.
// Ссылается на Block 4,9, используется в Block 9.

  const updateVisibleData = () => { // Функция обновления видимых данных
    console.log(`[updateVisibleData] Starting update`); // Лог старта
    if (!chart.current) { // Проверка чарта
      console.log(`[updateVisibleData] No chart instance`); // Лог отсутствия
      return; // Выход
    }
    const timeScale = chart.current.timeScale(); // Получение timescale
    if (!timeScale) { // Проверка
      console.log(`[updateVisibleData] No timeScale`); // Лог
      return; // Выход
    }
    const range = timeScale.getVisibleRange(); // Получение видимого диапазона
    if (!range) { // Проверка
      console.log(`[updateVisibleData] No visible range`); // Лог
      return; // Выход
    }

    timeScale.unsubscribeVisibleTimeRangeChange(handleRangeChange); // Временная отписка
    try { // Try блок для обработки
      const minTime = START_TIME; // Мин время
      const maxTime = START_TIME + (TOTAL_CANDLES - 1) * INTERVAL; // Макс время

      let from = range.from; // From диапазона
      let to = range.to; // To диапазона
      const duration = to - from; // Длительность

      const rawVisibleBars = Math.ceil(duration / INTERVAL); // Сырые видимые бары
      let aggregationFactor = 1; // Фактор агрегации
      if (rawVisibleBars > MAX_VISIBLE_BARS) { // Если превышает max
        aggregationFactor = Math.ceil(rawVisibleBars / MAX_VISIBLE_BARS) * AGGREGATION_FACTOR_BASE; // Вычисление фактора
      }
      if (rawVisibleBars > 1000000) { // Дополнительная агрессия
        aggregationFactor *= 2; // Увеличение фактора
      }

      console.log(`[updateVisibleData] Visible range: from=${from}, to=${to}, duration=${duration}, rawVisibleBars=${rawVisibleBars}, aggregationFactor=${aggregationFactor}`); // Лог диапазона

      // Add buffer
      const bufferTime = BUFFER_BARS * INTERVAL; // Буфер времени
      from = from - bufferTime; // Добавление буфера слева
      to = to + bufferTime; // Справа

      // Clamp to data bounds
      const clampedFrom = Math.max(from, minTime - bufferTime); // Кламп from
      const clampedTo = Math.min(to, maxTime + bufferTime); // Кламп to
      if (clampedFrom !== from || clampedTo !== to) { // Если изменилось
        timeScale.setVisibleRange({ from: clampedFrom, to: clampedTo }); // Установка clamped
      }
      from = clampedFrom; // Обновление from
      to = clampedTo; // Обновление to

      // Calculate indices
      const minIndex = Math.floor((from - START_TIME) / INTERVAL); // Мин индекс
      const maxIndex = Math.ceil((to - START_TIME) / INTERVAL); // Макс индекс

      console.log(`[updateVisibleData] Calculated indices: minIndex=${minIndex}, maxIndex=${maxIndex}`); // Лог индексов

      // Effective range for raw data (adjusted for aggregation)
      let effectiveMinIndex = Math.max(0, Math.floor(minIndex / aggregationFactor) * aggregationFactor); // Эффективный мин
      let effectiveMaxIndex = Math.min(TOTAL_CANDLES - 1, Math.ceil(maxIndex / aggregationFactor) * aggregationFactor - 1); // Эффективный макс

      console.log(`[updateVisibleData] Effective indices: min=${effectiveMinIndex}, max=${effectiveMaxIndex}, currentMin=${currentMinIndex.current}, currentMax=${currentMaxIndex.current}`); // Лог эффективных

      if (effectiveMaxIndex < effectiveMinIndex) { // Invalid
        console.log(`[updateVisibleData] Invalid effective range: updating with available data`); // Лог
        const displayData = aggregateCandles(currentRawData.current, aggregationFactor); // Агрегация текущих
        updateChartData(displayData); // Обновление
        chart.current.timeScale().applyOptions({}); // Force redraw
        return; // Выход
      }

      // Check if current raw data covers the required range; if yes, skip loading to avoid unnecessary updates
      if (effectiveMinIndex >= currentMinIndex.current && effectiveMaxIndex <= currentMaxIndex.current) { // Покрывает
        console.log(`[updateVisibleData] Current data covers range: slicing and aggregating`); // Лог
        // Still need to aggregate and update if aggregation changed
        const rawSlice = currentRawData.current.slice( // Слайс сырых
          effectiveMinIndex - currentMinIndex.current, // Старт
          (effectiveMaxIndex - currentMinIndex.current) + 1 // Конец
        );
        const displayData = aggregateCandles(rawSlice, aggregationFactor); // Агрегация
        updateChartData(displayData); // Обновление
        chart.current.timeScale().applyOptions({}); // Force redraw
        return; // Выход
      }

      let loadedLeft = false; // Флаг загрузки слева
      let loadedRight = false; // Справа

      // Load additional data if needed (prepend left or append right)
      if (effectiveMinIndex < currentMinIndex.current) { // Нужно слева
        // Load left (earlier data)
        const leftOffset = effectiveMinIndex; // Offset слева
        const leftLimit = currentMinIndex.current - effectiveMinIndex; // Limit слева
        console.log(`[updateVisibleData] Loading left: limit=${leftLimit}, from=${leftOffset}`); // Лог
        const newRawData = loadData(leftOffset, leftLimit); // Загрузка
        // Prepend to current raw
        currentRawData.current = [...newRawData, ...currentRawData.current]; // Prepend
        currentMinIndex.current = effectiveMinIndex; // Обновление мин
        loadedLeft = true; // Флаг
      }

      if (effectiveMaxIndex > currentMaxIndex.current) { // Нужно справа
        // Load right (later data)
        const rightOffset = currentMaxIndex.current + 1; // Offset справа
        const rightLimit = effectiveMaxIndex - currentMaxIndex.current; // Limit
        console.log(`[updateVisibleData] Loading right: limit=${rightLimit}, from=${rightOffset}`); // Лог
        const newRawData = loadData(rightOffset, rightLimit); // Загрузка
        // Append to current raw
        currentRawData.current = [...currentRawData.current, ...newRawData]; // Append
        currentMaxIndex.current = effectiveMaxIndex; // Обновление макс
        loadedRight = true; // Флаг
      }

      // Trim excess raw data to prevent memory growth
      if (currentRawData.current.length > MAX_RAW_SIZE) { // Если превышает max
        const excess = currentRawData.current.length - MAX_RAW_SIZE; // Избыток
        console.log(`[updateVisibleData] Trimming excess raw data: excess=${excess}, loadedLeft=${loadedLeft}, loadedRight=${loadedRight}`); // Лог
        if (loadedLeft && !loadedRight) { // Trim right
          currentRawData.current = currentRawData.current.slice(0, -excess); // Слайс слева
          currentMaxIndex.current -= excess; // Обновление макс
        } else if (loadedRight && !loadedLeft) { // Trim left
          currentRawData.current = currentRawData.current.slice(excess); // Слайс справа
          currentMinIndex.current += excess; // Обновление мин
        } else { // Trim left by default
          currentRawData.current = currentRawData.current.slice(excess); // Слайс слева
          currentMinIndex.current += excess; // Обновление
        }
      }

      // Adjust effective indices after trim to prevent negative slice
      effectiveMinIndex = Math.max(effectiveMinIndex, currentMinIndex.current); // Корректировка мин
      effectiveMaxIndex = Math.min(effectiveMaxIndex, currentMaxIndex.current); // Макс

      // Extract the slice for the effective range from updated raw data
      const rawSliceStart = effectiveMinIndex - currentMinIndex.current; // Старт слайса
      const rawSliceEnd = (effectiveMaxIndex - currentMinIndex.current) + 1; // Конец
      console.log(`[updateVisibleData] Slicing raw data: start=${rawSliceStart}, end=${rawSliceEnd}`); // Лог
      const rawSlice = currentRawData.current.slice(rawSliceStart, rawSliceEnd); // Слайс

      // Apply aggregation if needed
      const displayData = aggregateCandles(rawSlice, aggregationFactor); // Агрегация

      // Update chart data (replace, but now only when necessary)
      updateChartData(displayData); // Обновление

      chart.current.timeScale().applyOptions({}); // Force a full redraw
    } finally { // Finally для подписки обратно
      timeScale.subscribeVisibleTimeRangeChange(handleRangeChange); // Подписка
      console.log(`[updateVisibleData] Update complete`); // Лог завершения
    }
  };

// Block 11: Функция loadData
// Загружает данные с кэшированием чанков из fetchCandles.
// Ссылается на Block 3,2, используется в Block 7 и Block 10.

  const loadData = (offset, limit) => { // Функция загрузки данных
    console.log(`[loadData] Starting: offset=${offset}, limit=${limit}`); // Лог
    offset = Math.max(0, offset); // Кламп offset
    if (offset >= TOTAL_CANDLES) { // Если за пределами
      console.log(`[loadData] Offset exceeds total: returning []`); // Лог
      return []; // Пустой
    }
    limit = Math.min(limit, TOTAL_CANDLES - offset); // Кламп limit
    if (limit <= 0) { // Если <=0
      console.log(`[loadData] Limit <=0: returning []`); // Лог
      return []; // Пустой
    }

    const data = []; // Массив данных
    let currentOffset = offset; // Текущий offset
    let remaining = limit; // Остаток

    while (remaining > 0) { // Пока остаток >0
      const chunkOffset = Math.floor(currentOffset / CHUNK_SIZE) * CHUNK_SIZE; // Offset чанка
      const chunkKey = chunkOffset; // Ключ чанка
      console.log(`[loadData] Processing chunk: key=${chunkKey}, currentOffset=${currentOffset}, remaining=${remaining}`); // Лог

      let chunkData; // Данные чанка
      if (dataCache.current.has(chunkKey)) { // Если в кэше
        console.log(`[loadData] Cache hit for key=${chunkKey}`); // Лог хита
        chunkData = dataCache.current.get(chunkKey); // Получение
      } else { // Мисс
        // Fetch from mock backend
        console.log(`[loadData] Cache miss: fetching chunk from offset=${chunkOffset}`); // Лог мисса
        chunkData = fetchCandles(chunkOffset, CHUNK_SIZE); // Fetch
        dataCache.current.set(chunkKey, chunkData); // Set в кэш
        // Evict old caches if too many (simple LRU approximation, limit to 6 chunks ~3M candles)
        if (dataCache.current.size > 6) { // Если >6
          const oldestKey = dataCache.current.keys().next().value; // Старый ключ
          console.log(`[loadData] Evicting oldest cache: key=${oldestKey}`); // Лог eviction
          dataCache.current.delete(oldestKey); // Удаление
        }
      }

      // Slice the relevant part from chunk
      const startInChunk = currentOffset - chunkOffset; // Старт в чанке
      const take = Math.min(remaining, chunkData.length - startInChunk); // Сколько взять
      if (take <= 0) { // Если <=0
        console.log(`[loadData] Take <=0: breaking loop`); // Лог
        break; // Break
      }

      // Avoid spread for large arrays to prevent stack overflow
      const sliced = chunkData.slice(startInChunk, startInChunk + take); // Слайс
      console.log(`[loadData] Slicing chunk: start=${startInChunk}, take=${take}, sliced.length=${sliced.length}`); // Лог
      for (const item of sliced) { // Добавление в data
        data.push(item); // Push
      }

      currentOffset += take; // Обновление offset
      remaining -= take; // Уменьшение остатка
    }

    console.log(`[loadData] Loaded total: ${data.length}`); // Лог tổng
    return data; // Возврат
  };

// Block 12: useEffect для ресайза чарта
// Ресайзит чарт и canvas при изменении размеров.
// Ссылается на Block 5, выполняется при изменении currentWidth/Height.

  React.useEffect(() => { // Effect для ресайза
    console.log(`[DraggableResizableChart] Resizing chart: width=${currentWidth}, height=${currentHeight}`); // Лог
    if (chart.current) { // Если чарт
      chart.current.resize(currentWidth, currentHeight - TOOLBAR_HEIGHT, true); // Ресайз
    }
    if (canvasRef.current) { // Если canvas
      canvasRef.current.width = currentWidth; // Установка ширины
      canvasRef.current.height = currentHeight - TOOLBAR_HEIGHT; // Высоты
    }
    requestAnimationFrame(() => drawAnnotations()); // Запрос на рисование
  }, [currentWidth, currentHeight]); // Зависимости

// Block 13: Функция drawAnnotations
// Рисует аннотации на canvas, с клиппингом.
// Ссылается на Block 5, используется в многих effects и функциях.

  const drawAnnotations = React.useCallback(() => { // Callback для рисования аннотаций
    console.log(`[drawAnnotations] Starting draw: historyIndex=${historyIndex}, annotations.length=${history[historyIndex]?.length}`); // Лог
    if (!canvasRef.current || !chart.current || !candleSeries.current) { // Проверка refs
      console.log(`[drawAnnotations] Missing refs: canvas=${!!canvasRef.current}, chart=${!!chart.current}, candleSeries=${!!candleSeries.current}`); // Лог
      return; // Выход
    }
    const ctx = canvasRef.current.getContext('2d'); // Контекст
    const canvasWidth = canvasRef.current.width; // Ширина canvas
    const canvasHeight = canvasRef.current.height; // Высота
    console.log(`[drawAnnotations] Canvas size: width=${canvasWidth}, height=${canvasHeight}`); // Лог
    ctx.clearRect(0, 0, canvasWidth, canvasHeight); // Очистка
    ctx.strokeStyle = 'black'; // Стиль stroke
    ctx.fillStyle = 'black'; // Fill
    ctx.lineWidth = 2; // Ширина линии

    const timeScale = chart.current.timeScale(); // TimeScale
    const paneWidth = timeScale.width(); // Ширина pane
    const paneHeight = canvasHeight - timeScale.height(); // Высота pane
    console.log(`[drawAnnotations] Pane size: width=${paneWidth}, height=${paneHeight}`); // Лог

    const maxPrice = candleSeries.current.coordinateToPrice(0); // Макс цена
    const minPrice = candleSeries.current.coordinateToPrice(paneHeight); // Мин
    if (maxPrice === null || minPrice === null) { // Invalid
      console.log(`[drawAnnotations] Invalid prices: max=${maxPrice}, min=${minPrice}`); // Лог
      return; // Выход
    }

    const topY = candleSeries.current.priceToCoordinate(maxPrice); // Top Y
    const bottomY = candleSeries.current.priceToCoordinate(minPrice); // Bottom Y
    console.log(`[drawAnnotations] Price coords: topY=${topY}, bottomY=${bottomY}`); // Лог

    ctx.save(); // Save контекста
    ctx.beginPath(); // Начало пути
    ctx.rect(0, topY, paneWidth, bottomY - topY); // Rect для клипа
    ctx.clip(); // Клип

    history[historyIndex].forEach(ann => { // Цикл по аннотациям
      let x1 = timeScale.timeToCoordinate(ann.p1.time); // X1
      let y1 = candleSeries.current.priceToCoordinate(ann.p1.value); // Y1
      if (x1 === null || y1 === null) { // Invalid
        console.log(`[drawAnnotations] Invalid coords for ann: x1=${x1}, y1=${y1}`); // Лог
        return; // Продолжить
      }
      // Clamp coords to visible pane to handle out-of-bounds
      x1 = Math.max(0, Math.min(paneWidth, x1)); // Кламп X1
      y1 = Math.max(topY, Math.min(bottomY, y1)); // Y1

      if (ann.type === 'text') { // Если текст
        if (x1 < 0 || x1 > paneWidth || y1 < topY || y1 > bottomY) { // Out of bounds
          console.log(`[drawAnnotations] Text out of bounds: x1=${x1}, y1=${y1}`); // Лог
          return; // Продолжить
        }
        ctx.font = '14px Arial'; // Фонт
        ctx.fillText(ann.text, x1, y1); // Рисование текста
        return; // Продолжить
      }

      let x2 = timeScale.timeToCoordinate(ann.p2.time); // X2
      let y2 = candleSeries.current.priceToCoordinate(ann.p2.value); // Y2
      if (x2 === null || y2 === null) { // Invalid
        console.log(`[drawAnnotations] Invalid coords for ann: x2=${x2}, y2=${y2}`); // Лог
        return; // Продолжить
      }
      // Clamp coords to visible pane
      x2 = Math.max(0, Math.min(paneWidth, x2)); // Кламп X2
      y2 = Math.max(topY, Math.min(bottomY, y2)); // Y2

      const minX = Math.min(x1, x2); // Мин X
      const maxX = Math.max(x1, x2); // Макс X
      const minY = Math.min(y1, y2); // Мин Y
      const maxY = Math.max(y1, y2); // Макс Y
      if (maxX < 0 || minX > paneWidth || maxY < topY || minY > bottomY) { // Out of bounds
        console.log(`[drawAnnotations] Annotation out of bounds: minX=${minX}, maxX=${maxX}, minY=${minY}, maxY=${maxY}`); // Лог
        return; // Продолжить
      }

      if (ann.type === 'line') { // Если линия
        ctx.beginPath(); // Начало
        ctx.moveTo(x1, y1); // Move to
        ctx.lineTo(x2, y2); // Line to
        ctx.stroke(); // Stroke
      } else if (ann.type === 'rectangle') { // Прямоугольник
        const rectX = minX; // X rect
        const rectY = minY; // Y
        const rectW = maxX - minX; // Ширина
        const rectH = maxY - minY; // Высота
        ctx.strokeRect(rectX, rectY, rectW, rectH); // Stroke rect
      }
    });

    ctx.restore(); // Restore
    console.log(`[drawAnnotations] Draw complete`); // Лог завершения
  }, [history, historyIndex]); // Зависимости callback

// Block 14: useEffect для подписки на изменения диапазона
// Подписывается на изменения для redraw аннотаций.
// Ссылается на Block 13, выполняется при изменении drawAnnotations.

  React.useEffect(() => { // Effect для подписки
    console.log(`[DraggableResizableChart] Subscribing to range changes for redraw`); // Лог
    if (!chart.current || !candleSeries.current) return; // Проверка

    const timeScale = chart.current.timeScale(); // TimeScale
    const redraw = () => drawAnnotations(); // Функция redraw
    timeScale.subscribeVisibleTimeRangeChange(redraw); // Подписка на time range
    timeScale.subscribeVisibleLogicalRangeChange(redraw); // На logical range

    drawAnnotations(); // Начальное рисование

    return () => { // Cleanup
      console.log(`[DraggableResizableChart] Unsubscribing from range changes`); // Лог
      timeScale.unsubscribeVisibleTimeRangeChange(redraw); // Отписка
      timeScale.unsubscribeVisibleLogicalRangeChange(redraw); // Отписка
    };
  }, [drawAnnotations]); // Зависимость

// Block 15: useEffect для интервала проверки цен
// Проверяет изменения цен для redraw каждые 100ms.
// Ссылается на Block 13, выполняется при изменении drawAnnotations.

  React.useEffect(() => { // Effect для интервала
    console.log(`[DraggableResizableChart] Setting up price change interval`); // Лог
    if (!chart.current || !candleSeries.current || !canvasRef.current) return; // Проверка

    let prevMaxPrice = null; // Предыдущий max price
    let prevMinPrice = null; // Min

    const interval = setInterval(() => { // Интервал 100ms
      const canvasHeight = canvasRef.current.height; // Высота canvas
      const timeScaleHeight = chart.current.timeScale().height(); // Высота timescale
      const paneHeight = canvasHeight - timeScaleHeight; // Высота pane

      const maxPrice = candleSeries.current.coordinateToPrice(0); // Max price
      const minPrice = candleSeries.current.coordinateToPrice(paneHeight); // Min

      if (maxPrice === null || minPrice === null) { // Invalid
        console.log(`[DraggableResizableChart] Invalid prices in interval: max=${maxPrice}, min=${minPrice}`); // Лог
        return; // Пропуск
      }

      if (maxPrice !== prevMaxPrice || minPrice !== prevMinPrice) { // Изменилось
        console.log(`[DraggableResizableChart] Price change detected: max=${maxPrice}, min=${minPrice}`); // Лог
        prevMaxPrice = maxPrice; // Обновление
        prevMinPrice = minPrice; // Обновление
        drawAnnotations(); // Redraw
      }
    }, 100); // 100ms

    return () => { // Cleanup
      console.log(`[DraggableResizableChart] Clearing price change interval`); // Лог
      clearInterval(interval); // Очистка
    };
  }, [drawAnnotations]); // Зависимость

// Block 16: useEffect для redraw при изменении инструмента
// Redraw аннотаций при смене инструмента.
// Ссылается на Block 13, выполняется при изменении currentTool.

  React.useEffect(() => { // Effect
    console.log(`[DraggableResizableChart] Triggering drawAnnotations on currentTool change: currentTool=${currentTool}`); // Лог
    drawAnnotations(); // Redraw
  }, [drawAnnotations, currentTool]); // Зависимости

// Block 17: useEffect для mouse событий
// Настраивает слушатели mouse для рисования аннотаций.
// Ссылается на Block 13,5, выполняется при изменении currentTool/history/etc.

  React.useEffect(() => { // Effect для mouse
    console.log(`[DraggableResizableChart] Setting up mouse event listeners: currentTool=${currentTool}`); // Лог
    const canvas = canvasRef.current; // Canvas
    if (!canvas || !chart.current || !candleSeries.current) return; // Проверка

    const getCoords = (e) => { // Функция получения coords
      const rect = canvas.getBoundingClientRect(); // Rect canvas
      const x = e.clientX - rect.left; // X
      const y = e.clientY - rect.top; // Y
      const time = chart.current.timeScale().coordinateToTime(x) || START_TIME; // Time или default
      const value = candleSeries.current.coordinateToPrice(y) || 100; // Value или default
      console.log(`[getCoords] Coords: x=${x}, y=${y}, time=${time}, value=${value}`); // Лог
      return { time, value }; // Возврат
    };

    const onMouseDown = (e) => { // Mouse down
      console.log(`[onMouseDown] Mouse down: currentTool=${currentTool}`); // Лог
      const coords = getCoords(e); // Coords
      if (currentTool === 'line' || currentTool === 'rectangle') { // Для line/rect
        startPoint.current = coords; // Set start
        console.log(`[onMouseDown] Start point set: ${JSON.stringify(coords)}`); // Лог
      } else if (currentTool === 'text') { // Для text
        const text = prompt('Введите текст:'); // Prompt
        if (text) { // Если текст
          console.log(`[onMouseDown] Adding text annotation: text=${text}, coords=${JSON.stringify(coords)}`); // Лог
          addAnnotation({ type: 'text', text, p1: coords }); // Добавление
        }
      } else if (currentTool === 'eraser') { // Для eraser
        const hit = findHitAnnotation(e.clientX, e.clientY); // Поиск хита
        console.log(`[onMouseDown] Eraser hit: ${hit}`); // Лог
        if (hit !== null) { // Если hit
          removeAnnotation(hit); // Удаление
        }
      }
    };

    const onMouseMove = (e) => { // Mouse move
      if (!startPoint.current) return; // Если нет start
      console.log(`[onMouseMove] Mouse move while drawing: currentTool=${currentTool}`); // Лог
      const ctx = canvas.getContext('2d'); // Контекст
      drawAnnotations(); // Redraw
      ctx.save(); // Save
      const timeScale = chart.current.timeScale(); // TimeScale
      const paneWidth = timeScale.width(); // Ширина
      const paneHeight = ctx.canvas.height - timeScale.height(); // Высота
      const maxPrice = candleSeries.current.coordinateToPrice(0); // Max
      const minPrice = candleSeries.current.coordinateToPrice(paneHeight); // Min
      if (maxPrice === null || minPrice === null) { // Invalid
        console.log(`[onMouseMove] Invalid prices: max=${maxPrice}, min=${minPrice}`); // Лог
        ctx.restore(); // Restore
        return; // Выход
      }
      const topY = candleSeries.current.priceToCoordinate(maxPrice); // Top
      const bottomY = candleSeries.current.priceToCoordinate(minPrice); // Bottom
      ctx.beginPath(); // Path
      ctx.rect(0, topY, paneWidth, bottomY - topY); // Rect
      ctx.clip(); // Clip
      ctx.strokeStyle = 'gray'; // Стиль
      const coords = getCoords(e); // Coords
      const x1 = chart.current.timeScale().timeToCoordinate(startPoint.current.time); // X1
      const y1 = candleSeries.current.priceToCoordinate(startPoint.current.value); // Y1
      const x2 = chart.current.timeScale().timeToCoordinate(coords.time); // X2
      const y2 = candleSeries.current.priceToCoordinate(coords.value); // Y2
      if (currentTool === 'line') { // Line
        ctx.beginPath(); // Path
        ctx.moveTo(x1, y1); // Move
        ctx.lineTo(x2, y2); // Line
        ctx.stroke(); // Stroke
      } else if (currentTool === 'rectangle') { // Rect
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); // Stroke
      }
      ctx.restore(); // Restore
    };

    const onMouseUp = (e) => { // Mouse up
      if (!startPoint.current) return; // Если нет start
      console.log(`[onMouseUp] Mouse up: adding annotation`); // Лог
      const coords = getCoords(e); // Coords
      addAnnotation({ type: currentTool, p1: startPoint.current, p2: coords }); // Добавление
      startPoint.current = null; // Reset start
      drawAnnotations(); // Redraw
    };

    const addAnnotation = (ann) => { // Функция добавления
      console.log(`[addAnnotation] Adding: ${JSON.stringify(ann)}`); // Лог
      const newAnnotations = [...history[historyIndex], ann]; // Новые аннотации
      const newHistory = [...history.slice(0, historyIndex + 1), newAnnotations]; // Новая история
      setHistory(newHistory); // Set history
      setHistoryIndex(newHistory.length - 1); // Set index
      updateAnnotations(id, newAnnotations); // Update пропс
    };

    const removeAnnotation = (index) => { // Удаление
      console.log(`[removeAnnotation] Removing index=${index}`); // Лог
      const newAnnotations = history[historyIndex].filter((_, i) => i !== index); // Фильтр
      const newHistory = [...history.slice(0, historyIndex + 1), newAnnotations]; // Новая история
      setHistory(newHistory); // Set
      setHistoryIndex(newHistory.length - 1); // Index
      updateAnnotations(id, newAnnotations); // Update
    };

    const findHitAnnotation = (clientX, clientY) => { // Поиск хита
      console.log(`[findHitAnnotation] Checking hit: clientX=${clientX}, clientY=${clientY}`); // Лог
      const rect = canvas.getBoundingClientRect(); // Rect
      const x = clientX - rect.left; // X
      const y = clientY - rect.top; // Y
      const ctx = canvas.getContext('2d'); // Контекст
      const timeScale = chart.current.timeScale(); // TimeScale
      for (let i = history[historyIndex].length - 1; i >= 0; i--) { // Цикл обратный
        const ann = history[historyIndex][i]; // Ann
        const x1 = timeScale.timeToCoordinate(ann.p1.time); // X1
        const y1 = candleSeries.current.priceToCoordinate(ann.p1.value); // Y1
        if (x1 === null || y1 === null) { // Invalid
          console.log(`[findHitAnnotation] Invalid coords for ann ${i}: x1=${x1}, y1=${y1}`); // Лог
          continue; // Продолжить
        }

        if (ann.type === 'text') { // Text
          ctx.font = '14px Arial'; // Фонт
          const metrics = ctx.measureText(ann.text); // Метрики
          if (x >= x1 && x <= x1 + metrics.width && y >= y1 - 14 && y <= y1) { // Hit
            console.log(`[findHitAnnotation] Hit text at index=${i}`); // Лог
            return i; // Возврат index
          }
        } else { // Другие
          const x2 = timeScale.timeToCoordinate(ann.p2.time); // X2
          const y2 = candleSeries.current.priceToCoordinate(ann.p2.value); // Y2
          if (x2 === null || y2 === null) { // Invalid
            console.log(`[findHitAnnotation] Invalid coords for ann ${i}: x2=${x2}, y2=${y2}`); // Лог
            continue; // Продолжить
          }

          const minX = Math.min(x1, x2); // Мин X
          const maxX = Math.max(x1, x2); // Макс
          const minY = Math.min(y1, y2); // Мин Y
          const maxY = Math.max(y1, y2); // Макс

          if (ann.type === 'rectangle') { // Rect
            if (x >= minX && x <= maxX && y >= minY && y <= maxY) { // Hit
              console.log(`[findHitAnnotation] Hit rectangle at index=${i}`); // Лог
              return i; // Возврат
            }
          } else if (ann.type === 'line') { // Line
            const dx = x2 - x1; // Dx
            const dy = y2 - y1; // Dy
            const distance = Math.abs(dy * (x - x1) - dx * (y - y1)) / Math.sqrt(dx * dx + dy * dy); // Дистанция
            const bbHit = x >= minX && x <= maxX && y >= minY && y <= maxY; // Bounding box hit
            if (distance <= 5 && bbHit) { // Hit if distance <=5
              console.log(`[findHitAnnotation] Hit line at index=${i}, distance=${distance}`); // Лог
              return i; // Возврат
            }
          }
        }
      }
      console.log(`[findHitAnnotation] No hit`); // Лог no hit
      return null; // Null
    };

    canvas.addEventListener('mousedown', onMouseDown); // Listener down
    canvas.addEventListener('mousemove', onMouseMove); // Move
    canvas.addEventListener('mouseup', onMouseUp); // Up

    return () => { // Cleanup
      console.log(`[DraggableResizableChart] Removing mouse event listeners`); // Лог
      canvas.removeEventListener('mousedown', onMouseDown); // Remove
      canvas.removeEventListener('mousemove', onMouseMove); // Remove
      canvas.removeEventListener('mouseup', onMouseUp); // Remove
    };
  }, [currentTool, history, historyIndex, id, updateAnnotations, drawAnnotations]); // Зависимости

// Block 18: useEffect для keydown
// Обработка undo/redo с Ctrl+Z/Y.
// Ссылается на Block 5, выполняется при изменении history/etc.

  React.useEffect(() => { // Effect для keydown
    console.log(`[DraggableResizableChart] Setting up keydown listener`); // Лог
    const handleKeyDown = (e) => { // Handler
      console.log(`[handleKeyDown] Key down: key=${e.key}, ctrl/meta=${e.ctrlKey || e.metaKey}`); // Лог
      if (e.ctrlKey || e.metaKey) { // Ctrl или meta
        if (e.key === 'z') { // Z for undo
          if (historyIndex > 0) { // Если можно
            console.log(`[handleKeyDown] Undo: newIndex=${historyIndex - 1}`); // Лог
            setHistoryIndex(historyIndex - 1); // Set index
            updateAnnotations(id, history[historyIndex - 1]); // Update
          }
        } else if (e.key === 'y') { // Y for redo
          if (historyIndex < history.length - 1) { // Можно
            console.log(`[handleKeyDown] Redo: newIndex=${historyIndex + 1}`); // Лог
            setHistoryIndex(historyIndex + 1); // Set
            updateAnnotations(id, history[historyIndex + 1]); // Update
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown); // Listener
    return () => { // Cleanup
      console.log(`[DraggableResizableChart] Removing keydown listener`); // Лог
      window.removeEventListener('keydown', handleKeyDown); // Remove
    };
  }, [history, historyIndex, id, updateAnnotations]); // Зависимости

// Block 19: Функции onResize и onResizeStop
// Обработка ресайза.
// Ссылается на Block 5,13, используется в JSX.

  const onResize = (event, { size }) => { // On resize
    console.log(`[onResize] Resizing: width=${size.width}, height=${size.height}`); // Лог
    setCurrentWidth(size.width); // Set width
    setCurrentHeight(size.height); // Height
    if (chart.current) { // Если чарт
      chart.current.resize(size.width, size.height - TOOLBAR_HEIGHT, true); // Resize
    }
    if (canvasRef.current) { // Canvas
      canvasRef.current.width = size.width; // Width
      canvasRef.current.height = size.height - TOOLBAR_HEIGHT; // Height
    }
    requestAnimationFrame(() => drawAnnotations()); // Redraw
  };

  const onResizeStop = (event, { size }) => { // On stop
    console.log(`[onResizeStop] Resize stop: width=${size.width}, height=${size.height}`); // Лог
    resizeChart(id, size.width, size.height); // Call resizeChart
  };

// Block 20: useDrag хук
// Настройка drag для чарта.
// Ссылается на Block 1, используется в JSX.

  const [{ isDragging }, drag] = useDrag({ // Use drag
    type: CHART_TYPE, // Type
    item: { id, left, top, width, height }, // Item
    collect: (monitor) => ({ isDragging: monitor.isDragging() }), // Collect
  });
  console.log(`[DraggableResizableChart] Drag state: isDragging=${isDragging}`); // Лог

// Block 21: Инструменты и handleToolClick
// Определение инструментов и обработчик клика.
// Используется в JSX.

  const tools = [ // Массив инструментов
    { name: 'line', label: 'Линия' }, // Line
    { name: 'rectangle', label: 'Прямоугольник' }, // Rect
    { name: 'text', label: 'Текст' }, // Text
    { name: 'eraser', label: 'Ластик' }, // Eraser
    { name: 'clear', label: 'Очистить' }, // Clear
  ];

  const handleToolClick = (tool) => { // Handler клика
    console.log(`[handleToolClick] Tool clicked: ${tool}`); // Лог
    if (tool === 'clear') { // Clear
      const newAnnotations = []; // Пустые
      const newHistory = [...history.slice(0, historyIndex + 1), newAnnotations]; // Новая история
      setHistory(newHistory); // Set
      setHistoryIndex(newHistory.length - 1); // Index
      updateAnnotations(id, newAnnotations); // Update
      setCurrentTool(null); // Reset tool
    } else { // Другие
      setCurrentTool(currentTool === tool ? null : tool); // Toggle tool
    }
  };

// Block 22: JSX return компонента
// Рендерит Resizable с чартом, тулбаром, canvas.

  return ( // Return JSX
    <Resizable // Resizable
      width={currentWidth} // Width
      height={currentHeight} // Height
      onResize={onResize} // On resize
      onResizeStop={onResizeStop} // On stop
      minConstraints={[200, 200]} // Min constraints
      resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 'n', 's']} // Handles
    >
      <div style={{ position: 'absolute', left, top, opacity: isDragging ? 0.5 : 1, border: '1px solid gray', width: currentWidth, height: currentHeight, background: 'white' }}> // Div container
        <div ref={drag} style={{ height: TOOLBAR_HEIGHT, display: 'flex', background: '#f0f0f0', padding: 5, cursor: 'move' }}> // Toolbar div
          {tools.map(tool => ( // Map tools
            <button // Button
              key={tool.name} // Key
              onClick={() => handleToolClick(tool.name)} // On click
              style={{ // Style
                marginRight: 5, // Margin
                background: currentTool === tool.name ? '#DFDFDF' : 'white', // Background
              }}
            >
              {tool.label} // Label
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', width: '100%', height: `calc(100% - ${TOOLBAR_HEIGHT}px)` }}> // Chart container
          <div ref={chartRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }} /> // Chart div
          <canvas // Canvas
            ref={canvasRef} // Ref
            style={{ // Style
              position: 'absolute', // Position
              top: 0, // Top
              left: 0, // Left
              zIndex: 2, // Z
              pointerEvents: currentTool ? 'auto' : 'none', // Pointer events
            }}
          />
        </div>
      </div>
    </Resizable>
  );
};

// Block 23: Компонент InfiniteGrid
// Контейнер для чартов с grid и drop.
// Ссылается на Block 5, используется в Block 24.

const InfiniteGrid = () => { // Компонент
  const [charts, setCharts] = React.useState(() => { // State charts
    const saved = localStorage.getItem('charts'); // Get from local
    if (saved) return JSON.parse(saved); // Если есть, parse
    return [ // Default
      { id: 1, left: 0, top: 0, width: 400, height: 330, annotations: [] }, // Chart 1
      { id: 2, left: 400, top: 0, width: 400, height: 330, annotations: [] }, // 2
      { id: 3, left: 0, top: 330, width: 400, height: 330, annotations: [] }, // 3
      { id: 4, left: 400, top: 330, width: 400, height: 330, annotations: [] }, // 4
    ];
  });

  React.useEffect(() => { // Effect save to local
    console.log(`[InfiniteGrid] Saving charts to localStorage: count=${charts.length}`); // Лог
    localStorage.setItem('charts', JSON.stringify(charts)); // Set
  }, [charts]); // Зависимость

  const moveChart = (id, left, top, newWidth, newHeight) => { // Move функция
    console.log(`[moveChart] Moving chart: id=${id}, left=${left}, top=${top}, width=${newWidth}, height=${newHeight}`); // Лог
    setCharts((prev) => prev.map((chart) => (chart.id === id ? { ...chart, left, top, width: newWidth, height: newHeight } : chart))); // Update state
  };

  const resizeChart = (id, width, height) => { // Resize
    console.log(`[resizeChart] Resizing chart: id=${id}, width=${width}, height=${height}`); // Лог
    setCharts((prev) => prev.map((chart) => (chart.id === id ? { ...chart, width, height } : chart))); // Update
  };

  const updateAnnotations = (id, annotations) => { // Update ann
    console.log(`[updateAnnotations] Updating annotations for id=${id}: length=${annotations.length}`); // Лог
    setCharts((prev) => prev.map((chart) => (chart.id === id ? { ...chart, annotations } : chart))); // Update
  };

  const [, drop] = useDrop({ // Use drop
    accept: CHART_TYPE, // Accept type
    drop(item, monitor) { // Drop handler
      console.log(`[useDrop] Drop detected: item.id=${item.id}`); // Лог
      const delta = monitor.getDifferenceFromInitialOffset(); // Delta
      let newLeft = Math.round(item.left + delta.x); // New left
      let newTop = Math.round(item.top + delta.y); // Top

      const viewportWidth = window.innerWidth; // Viewport width
      const viewportHeight = window.innerHeight; // Height
      const cellWidth = Math.floor(viewportWidth / 2); // Cell width
      const cellHeight = Math.floor(viewportHeight / 2); // Height
      newLeft = Math.round(newLeft / cellWidth) * cellWidth; // Snap to grid
      newTop = Math.round(newTop / cellHeight) * cellHeight; // Snap

      newLeft = Math.max(0, Math.min(newLeft, viewportWidth - cellWidth)); // Clamp left
      newTop = Math.max(0, Math.min(newTop, viewportHeight - cellHeight)); // Clamp top

      const newWidth = cellWidth; // New width
      const newHeight = cellHeight; // Height

      moveChart(item.id, newLeft, newTop, newWidth, newHeight); // Call move
      return undefined; // Return
    },
  });

  React.useEffect(() => { // Effect for resize window
    const handleResize = () => { // Handler
      console.log(`[InfiniteGrid] Window resize detected`); // Лог
      const viewportWidth = window.innerWidth; // Width
      const viewportHeight = window.innerHeight; // Height
      const cellWidth = Math.floor(viewportWidth / 2); // Cell
      const cellHeight = Math.floor(viewportHeight / 2); // Cell
      setCharts((prev) => prev.map((chart) => ({ // Update charts
        ...chart, // Spread
        width: cellWidth, // Width
        height: cellHeight, // Height
        left: Math.round(chart.left / cellWidth) * cellWidth, // Snap left
        top: Math.round(chart.top / cellHeight) * cellHeight, // Top
      })));
    };

    window.addEventListener('resize', handleResize); // Listener
    handleResize(); // Initial call

    return () => { // Cleanup
      console.log(`[InfiniteGrid] Removing window resize listener`); // Лог
      window.removeEventListener('resize', handleResize); // Remove
    };
  }, []); // Empty deps

  return <div ref={drop} style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'auto' }}> // Return div
    <div style={{ position: 'absolute', top: 0, left: '50%', width: '1px', height: '100%', background: '#ccc', zIndex: 0 }} /> // Vertical line
    <div style={{ position: 'absolute', top: '50%', left: 0, height: '1px', width: '100%', background: '#ccc', zIndex: 0 }} /> // Horizontal
    {charts.map((chart) => ( // Map charts
      <DraggableResizableChart // Chart component
        key={chart.id} // Key
        id={chart.id} // Id
        left={chart.left} // Left
        top={chart.top} // Top
        width={chart.width} // Width
        height={chart.height} // Height
        annotations={chart.annotations} // Ann
        moveChart={moveChart} // Move func
        resizeChart={resizeChart} // Resize
        updateAnnotations={updateAnnotations} // Update ann
      />
    ))}
  </div>;
};

// Block 24: Компонент RootApp
// Провайдер DnD и InfiniteGrid.
// Ссылается на Block 1,23, используется в Block 25.

const RootApp = () => { // Root app
  return <DndProvider backend={HTML5Backend}> // DnD provider
    <InfiniteGrid /> // Grid
  </DndProvider>;
};

// Block 25: Рендеринг root
// Рендерит RootApp в DOM.
// Выполняется последним.

const rootElement = document.getElementById('root'); // Get root
if (rootElement) { // Если существует
  console.log(`[Root] Root element found, rendering app`); // Лог
  const root = ReactDOM.createRoot(rootElement); // Create root
  root.render(<RootApp />); // Render
} else { // Else
  console.error('Root element not found'); // Error
}