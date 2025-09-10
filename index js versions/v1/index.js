import React from 'react';
import ReactDOM from 'react-dom/client';
import { createChart } from 'lightweight-charts';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Resizable } from 'react-resizable';
import 'react-resizable/css/styles.css';

const CHART_TYPE = 'chart';
const TOOLBAR_HEIGHT = 30;

// Configuration constants
const START_SEED = 12345;
const START_LAST_CLOSE = 100;
const START_TIME = new Date('2020-01-01').getTime() / 1000;
const INTERVAL = 3600;
const TOTAL_CANDLES = 10000000; // 10M candles total
const CHUNK_SIZE = 500000; // Load by 500k blocks
const MAX_VISIBLE_BARS = 1000; // Threshold for aggregation
const BUFFER_BARS = 10000; // Changed: Increased to 10000 for more preload during panning, reducing the frequency of data loading and minimizing "stuck" behavior on left panning
const AGGREGATION_FACTOR_BASE = 1; // Base aggregation factor
const MAX_RAW_SIZE = CHUNK_SIZE * 3; // Max raw data to keep in memory

// Mock backend fetch function
// Simulates fetching candles by offset and limit
// Generates deterministic random OHLC data based on index
function fetchCandles(offset, limit) {
  // Limit to total candles
  const numCandles = Math.min(limit, TOTAL_CANDLES - offset);
  if (numCandles <= 0) return [];

  // Seeded random generator (Mulberry32)
  let state = (START_SEED + offset) >>> 0; // Start state based on offset for determinism
  const rand = () => {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const data = [];
  let lastClose = START_LAST_CLOSE + rand() * 10; // Initial close around 100
  for (let i = 0; i < numCandles; i++) {
    const time = START_TIME + (offset + i) * INTERVAL;
    const open = lastClose;
    const high = open + rand() * 10;
    const low = open - rand() * 10;
    const close = open + (rand() - 0.5) * 5;
    data.push({
      time,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
    });
    lastClose = close;
  }
  return data;
}

// Function to aggregate candles
// Groups every 'factor' candles into one OHLC bar
function aggregateCandles(candles, factor) {
  if (factor <= 1) return candles;

  const aggregated = [];
  for (let i = 0; i < candles.length; i += factor) {
    const group = candles.slice(i, i + factor);
    if (group.length === 0) break;

    const open = group[0].open;
    const close = group[group.length - 1].close;
    const high = Math.max(...group.map(c => c.high));
    const low = Math.min(...group.map(c => c.low));
    const time = group[0].time; // Use start time of group

    aggregated.push({ time, open, high, low, close });
  }
  return aggregated;
}

const DraggableResizableChart = ({ id, left, top, width, height, annotations, moveChart, resizeChart, updateAnnotations }) => {
  const chartRef = React.useRef(null);
  const canvasRef = React.useRef(null);
  const [currentTool, setCurrentTool] = React.useState(null);
  const [history, setHistory] = React.useState([annotations]);
  const [historyIndex, setHistoryIndex] = React.useState(0);
  const chart = React.useRef(null);
  const candleSeries = React.useRef(null);
  const lineSeries = React.useRef(null);
  const startPoint = React.useRef(null);
  const [currentWidth, setCurrentWidth] = React.useState(width);
  const [currentHeight, setCurrentHeight] = React.useState(height);
  const dataCache = React.useRef(new Map()); // Cache for fetched chunks (key: offset, value: array of candles)
  const currentRawData = React.useRef([]); // New: Store raw (non-aggregated) data that's currently loaded, to allow appending/prepending
  const currentMinIndex = React.useRef(0); // New: Track the min index of currentRawData
  const currentMaxIndex = React.useRef(0); // New: Track the max index of currentRawData
  const lastCall = React.useRef(0);

  React.useEffect(() => {
    setCurrentWidth(width);
    setCurrentHeight(height);
  }, [width, height]);

  // Setup chart
  React.useEffect(() => {
    if (chartRef.current) {
      chart.current = createChart(chartRef.current, {
        width: currentWidth,
        height: currentHeight - TOOLBAR_HEIGHT,
        timeScale: { 
          fixLeftEdge: false, 
          fixRightEdge: false, 
          timeVisible: true, 
          secondsVisible: false,
          lockVisibleTimeRangeOnResize: true,
          rightOffset: 0
        }, // Changed: Set fixRightEdge to false to allow panning right into empty space without artifacts and cyclic rendering issues
      });
      candleSeries.current = chart.current.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350' });
      lineSeries.current = chart.current.addLineSeries({ color: '#FF0000', lineWidth: 2 });

      // Initial load: last chunk for recent data
      const initialOffset = Math.max(0, TOTAL_CANDLES - CHUNK_SIZE - 2 * BUFFER_BARS); // Changed: Adjusted initialOffset to preload more historical data (2 * BUFFER_BARS) for smoother initial left panning without cycles
      const initialData = loadData(initialOffset, CHUNK_SIZE + 2 * BUFFER_BARS); // Changed: Made loadData sync and increased initial load limit to include extra buffer
      currentRawData.current = initialData; // Set initial raw data
      currentMinIndex.current = initialOffset;
      currentMaxIndex.current = initialOffset + initialData.length - 1;
      const aggregatedData = aggregateCandles(initialData, 1); // No aggregation initially
      updateChartData(aggregatedData);
      const last100 = aggregatedData.slice(-100);
      const timeScale = chart.current.timeScale();
      timeScale.subscribeVisibleTimeRangeChange(handleRangeChange);
      chart.current.timeScale().setVisibleRange({
        from: last100[0].time,
        to: last100[last100.length - 1].time,
      });

      return () => {
        timeScale.unsubscribeVisibleTimeRangeChange(handleRangeChange);
        chart.current.remove();
      };
    }
  }, [currentWidth, currentHeight]);

  const updateChartData = (data) => {
    candleSeries.current.setData(data);
    lineSeries.current.setData(data.map(d => ({ time: d.time, value: d.close + 10 })));
    drawAnnotations();
  };

  // Handler for visible range change (throttled)
  const handleRangeChange = () => {
    const now = performance.now();
    if (now - lastCall.current < 16) return;
    lastCall.current = now;
    updateVisibleData();
  };

  // Function to update data based on visible range
  const updateVisibleData = () => {
    if (!chart.current) return;
    const timeScale = chart.current.timeScale();
    if (!timeScale) return;
    const range = timeScale.getVisibleRange();
    if (!range) return;

    timeScale.unsubscribeVisibleTimeRangeChange(handleRangeChange);
    try {
      const minTime = START_TIME;
      const maxTime = START_TIME + (TOTAL_CANDLES - 1) * INTERVAL;

      let from = range.from;
      let to = range.to;
      const duration = to - from;

      const rawVisibleBars = Math.ceil(duration / INTERVAL);
      let aggregationFactor = 1;
      if (rawVisibleBars > MAX_VISIBLE_BARS) {
        aggregationFactor = Math.ceil(rawVisibleBars / MAX_VISIBLE_BARS) * AGGREGATION_FACTOR_BASE;
      }

      // console.log(`Visible range: from ${from} to ${to}, duration ${duration}, rawVisibleBars ${rawVisibleBars}, aggregationFactor ${aggregationFactor}`);

      // Add buffer
      const bufferTime = BUFFER_BARS * INTERVAL;
      from = from - bufferTime;
      to = to + bufferTime;

      // Calculate indices
      const minIndex = Math.floor((from - START_TIME) / INTERVAL);
      const maxIndex = Math.ceil((to - START_TIME) / INTERVAL);

      // console.log(`minIndex: ${minIndex}, maxIndex: ${maxIndex}`);

      // Effective range for raw data (adjusted for aggregation)
      let effectiveMinIndex = Math.max(0, Math.floor(minIndex / aggregationFactor) * aggregationFactor);
      let effectiveMaxIndex = Math.min(TOTAL_CANDLES - 1, Math.ceil(maxIndex / aggregationFactor) * aggregationFactor - 1);

      // console.log(`effectiveMin: ${effectiveMinIndex}, effectiveMax: ${effectiveMaxIndex}, currentMin: ${currentMinIndex.current}, currentMax: ${currentMaxIndex.current}`);

      if (effectiveMaxIndex < effectiveMinIndex) {
        updateChartData([]);
        chart.current.timeScale().applyOptions({}); // Force redraw
        return;
      }

      // Check if current raw data covers the required range; if yes, skip loading to avoid unnecessary updates
      if (effectiveMinIndex >= currentMinIndex.current && effectiveMaxIndex <= currentMaxIndex.current) {
        // Still need to aggregate and update if aggregation changed
        const rawSlice = currentRawData.current.slice(
          effectiveMinIndex - currentMinIndex.current,
          (effectiveMaxIndex - currentMinIndex.current) + 1
        );
        const displayData = aggregateCandles(rawSlice, aggregationFactor);
        updateChartData(displayData);
        chart.current.timeScale().applyOptions({}); // Force redraw
        return;
      }

      let loadedLeft = false;
      let loadedRight = false;

      // Load additional data if needed (prepend left or append right)
      if (effectiveMinIndex < currentMinIndex.current) {
        // Load left (earlier data)
        const leftOffset = effectiveMinIndex;
        const leftLimit = currentMinIndex.current - effectiveMinIndex;
        // console.log('Loading left', leftLimit, 'candles from', leftOffset);
        const newRawData = loadData(leftOffset, leftLimit); // Changed: Made loadData sync
        // Prepend to current raw
        currentRawData.current = [...newRawData, ...currentRawData.current];
        currentMinIndex.current = effectiveMinIndex;
        loadedLeft = true;
      }

      if (effectiveMaxIndex > currentMaxIndex.current) {
        // Load right (later data)
        const rightOffset = currentMaxIndex.current + 1;
        const rightLimit = effectiveMaxIndex - currentMaxIndex.current;
        // console.log('Loading right', rightLimit, 'candles from', rightOffset);
        const newRawData = loadData(rightOffset, rightLimit); // Changed: Made loadData sync
        // Append to current raw
        currentRawData.current = [...currentRawData.current, ...newRawData];
        currentMaxIndex.current = effectiveMaxIndex;
        loadedRight = true;
      }

      // Trim excess raw data to prevent memory growth
      if (currentRawData.current.length > MAX_RAW_SIZE) {
        const excess = currentRawData.current.length - MAX_RAW_SIZE;
        if (loadedLeft && !loadedRight) {
          // Trim right
          currentRawData.current = currentRawData.current.slice(0, -excess);
          currentMaxIndex.current -= excess;
        } else if (loadedRight && !loadedLeft) {
          // Trim left
          currentRawData.current = currentRawData.current.slice(excess);
          currentMinIndex.current += excess;
        } else {
          // Trim left by default
          currentRawData.current = currentRawData.current.slice(excess);
          currentMinIndex.current += excess;
        }
      }

      // Extract the slice for the effective range from updated raw data
      const rawSliceStart = effectiveMinIndex - currentMinIndex.current;
      const rawSliceEnd = (effectiveMaxIndex - currentMinIndex.current) + 1;
      const rawSlice = currentRawData.current.slice(rawSliceStart, rawSliceEnd);

      // Apply aggregation if needed
      const displayData = aggregateCandles(rawSlice, aggregationFactor);

      // Update chart data (replace, but now only when necessary)
      updateChartData(displayData);

      chart.current.timeScale().applyOptions({}); // Changed: Added applyOptions to force a full redraw and prevent rendering artifacts during cyclic panning
    } finally {
      timeScale.subscribeVisibleTimeRangeChange(handleRangeChange);
    }
  };

  // Load data with caching
  // Fetches in chunks of 500k, caches them
  const loadData = (offset, limit) => { // Changed: Removed async/await to make loadData fully synchronous, avoiding promise delays during panning
    offset = Math.max(0, offset);
    if (offset >= TOTAL_CANDLES) return [];
    limit = Math.min(limit, TOTAL_CANDLES - offset);
    if (limit <= 0) return [];

    const data = [];
    let currentOffset = offset;
    let remaining = limit;

    while (remaining > 0) {
      const chunkOffset = Math.floor(currentOffset / CHUNK_SIZE) * CHUNK_SIZE;
      const chunkKey = chunkOffset;

      let chunkData;
      if (dataCache.current.has(chunkKey)) {
        chunkData = dataCache.current.get(chunkKey);
      } else {
        // Fetch from mock backend
        chunkData = fetchCandles(chunkOffset, CHUNK_SIZE);
        dataCache.current.set(chunkKey, chunkData);
        // Evict old caches if too many (simple LRU approximation, limit to 4 chunks ~2M candles)
        if (dataCache.current.size > 4) {
          const oldestKey = dataCache.current.keys().next().value;
          dataCache.current.delete(oldestKey);
        }
      }

      // Slice the relevant part from chunk
      const startInChunk = currentOffset - chunkOffset;
      const take = Math.min(remaining, chunkData.length - startInChunk);
      if (take <= 0) break;

      // Avoid spread for large arrays to prevent stack overflow
      const sliced = chunkData.slice(startInChunk, startInChunk + take);
      for (const item of sliced) {
        data.push(item);
      }

      currentOffset += take;
      remaining -= take;
    }

    return data;
  };

  React.useEffect(() => {
    if (chart.current) {
      chart.current.resize(currentWidth, currentHeight - TOOLBAR_HEIGHT, true);
    }
    if (canvasRef.current) {
      canvasRef.current.width = currentWidth;
      canvasRef.current.height = currentHeight - TOOLBAR_HEIGHT;
    }
    requestAnimationFrame(() => drawAnnotations());
  }, [currentWidth, currentHeight]);

  const drawAnnotations = React.useCallback(() => {
    if (!canvasRef.current || !chart.current || !candleSeries.current) return;
    const ctx = canvasRef.current.getContext('2d');
    const canvasWidth = canvasRef.current.width;
    const canvasHeight = canvasRef.current.height;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.strokeStyle = 'black';
    ctx.fillStyle = 'black';
    ctx.lineWidth = 2;

    const timeScale = chart.current.timeScale();
    const paneWidth = timeScale.width();
    const paneHeight = canvasHeight - timeScale.height();

    const maxPrice = candleSeries.current.coordinateToPrice(0);
    const minPrice = candleSeries.current.coordinateToPrice(paneHeight);
    if (maxPrice === null || minPrice === null) return;

    const topY = candleSeries.current.priceToCoordinate(maxPrice);
    const bottomY = candleSeries.current.priceToCoordinate(minPrice);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, topY, paneWidth, bottomY - topY);
    ctx.clip();

    history[historyIndex].forEach(ann => {
      const x1 = timeScale.timeToCoordinate(ann.p1.time);
      const y1 = candleSeries.current.priceToCoordinate(ann.p1.value);
      if (x1 === null || y1 === null) return;

      if (ann.type === 'text') {
        if (x1 < 0 || x1 > paneWidth || y1 < topY || y1 > bottomY) return;
        ctx.font = '14px Arial';
        ctx.fillText(ann.text, x1, y1);
        return;
      }

      const x2 = timeScale.timeToCoordinate(ann.p2.time);
      const y2 = candleSeries.current.priceToCoordinate(ann.p2.value);
      if (x2 === null || y2 === null) return;

      const minX = Math.min(x1, x2);
      const maxX = Math.max(x1, x2);
      const minY = Math.min(y1, y2);
      const maxY = Math.max(y1, y2);
      if (maxX < 0 || minX > paneWidth || maxY < topY || minY > bottomY) return;

      if (ann.type === 'line') {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (ann.type === 'rectangle') {
        const rectX = minX;
        const rectY = minY;
        const rectW = maxX - minX;
        const rectH = maxY - minY;
        ctx.strokeRect(rectX, rectY, rectW, rectH);
      }
    });

    ctx.restore();
  }, [history, historyIndex]);

  React.useEffect(() => {
    if (!chart.current || !candleSeries.current) return;

    const timeScale = chart.current.timeScale();
    const redraw = () => drawAnnotations();
    timeScale.subscribeVisibleTimeRangeChange(redraw);
    timeScale.subscribeVisibleLogicalRangeChange(redraw);

    drawAnnotations();

    return () => {
      timeScale.unsubscribeVisibleTimeRangeChange(redraw);
      timeScale.unsubscribeVisibleLogicalRangeChange(redraw);
    };
  }, [drawAnnotations]);

  React.useEffect(() => {
    if (!chart.current || !candleSeries.current || !canvasRef.current) return;

    let prevMaxPrice = null;
    let prevMinPrice = null;

    const interval = setInterval(() => {
      const canvasHeight = canvasRef.current.height;
      const timeScaleHeight = chart.current.timeScale().height();
      const paneHeight = canvasHeight - timeScaleHeight;

      const maxPrice = candleSeries.current.coordinateToPrice(0);
      const minPrice = candleSeries.current.coordinateToPrice(paneHeight);

      if (maxPrice === null || minPrice === null) return;

      if (maxPrice !== prevMaxPrice || minPrice !== prevMinPrice) {
        prevMaxPrice = maxPrice;
        prevMinPrice = minPrice;
        drawAnnotations();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [drawAnnotations]);

  React.useEffect(() => {
    drawAnnotations();
  }, [drawAnnotations, currentTool]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chart.current || !candleSeries.current) return;

    const getCoords = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const time = chart.current.timeScale().coordinateToTime(x) || START_TIME;
      const value = candleSeries.current.coordinateToPrice(y) || 100;
      return { time, value };
    };

    const onMouseDown = (e) => {
      const coords = getCoords(e);
      if (currentTool === 'line' || currentTool === 'rectangle') {
        startPoint.current = coords;
      } else if (currentTool === 'text') {
        const text = prompt('Введите текст:');
        if (text) {
          addAnnotation({ type: 'text', text, p1: coords });
        }
      } else if (currentTool === 'eraser') {
        const hit = findHitAnnotation(e.clientX, e.clientY);
        if (hit !== null) {
          removeAnnotation(hit);
        }
      }
    };

    const onMouseMove = (e) => {
      if (!startPoint.current) return;
      const ctx = canvas.getContext('2d');
      drawAnnotations();
      ctx.save();
      const timeScale = chart.current.timeScale();
      const paneWidth = timeScale.width();
      const paneHeight = ctx.canvas.height - timeScale.height();
      const maxPrice = candleSeries.current.coordinateToPrice(0);
      const minPrice = candleSeries.current.coordinateToPrice(paneHeight);
      if (maxPrice === null || minPrice === null) {
        ctx.restore();
        return;
      }
      const topY = candleSeries.current.priceToCoordinate(maxPrice);
      const bottomY = candleSeries.current.priceToCoordinate(minPrice);
      ctx.beginPath();
      ctx.rect(0, topY, paneWidth, bottomY - topY);
      ctx.clip();
      ctx.strokeStyle = 'gray';
      const coords = getCoords(e);
      const x1 = chart.current.timeScale().timeToCoordinate(startPoint.current.time);
      const y1 = candleSeries.current.priceToCoordinate(startPoint.current.value);
      const x2 = chart.current.timeScale().timeToCoordinate(coords.time);
      const y2 = candleSeries.current.priceToCoordinate(coords.value);
      if (currentTool === 'line') {
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (currentTool === 'rectangle') {
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      }
      ctx.restore();
    };

    const onMouseUp = (e) => {
      if (!startPoint.current) return;
      const coords = getCoords(e);
      addAnnotation({ type: currentTool, p1: startPoint.current, p2: coords });
      startPoint.current = null;
      drawAnnotations();
    };

    const addAnnotation = (ann) => {
      const newAnnotations = [...history[historyIndex], ann];
      const newHistory = [...history.slice(0, historyIndex + 1), newAnnotations];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      updateAnnotations(id, newAnnotations);
    };

    const removeAnnotation = (index) => {
      const newAnnotations = history[historyIndex].filter((_, i) => i !== index);
      const newHistory = [...history.slice(0, historyIndex + 1), newAnnotations];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      updateAnnotations(id, newAnnotations);
    };

    const findHitAnnotation = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const ctx = canvas.getContext('2d');
      const timeScale = chart.current.timeScale();
      for (let i = history[historyIndex].length - 1; i >= 0; i--) {
        const ann = history[historyIndex][i];
        const x1 = timeScale.timeToCoordinate(ann.p1.time);
        const y1 = candleSeries.current.priceToCoordinate(ann.p1.value);
        if (x1 === null || y1 === null) continue;

        if (ann.type === 'text') {
          ctx.font = '14px Arial';
          const metrics = ctx.measureText(ann.text);
          if (x >= x1 && x <= x1 + metrics.width && y >= y1 - 14 && y <= y1) {
            return i;
          }
        } else {
          const x2 = timeScale.timeToCoordinate(ann.p2.time);
          const y2 = candleSeries.current.priceToCoordinate(ann.p2.value);
          if (x2 === null || y2 === null) continue;

          const minX = Math.min(x1, x2);
          const maxX = Math.max(x1, x2);
          const minY = Math.min(y1, y2);
          const maxY = Math.max(y1, y2);

          if (ann.type === 'rectangle') {
            if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
              return i;
            }
          } else if (ann.type === 'line') {
            const dx = x2 - x1;
            const dy = y2 - y1;
            const distance = Math.abs(dy * (x - x1) - dx * (y - y1)) / Math.sqrt(dx * dx + dy * dy);
            const bbHit = x >= minX && x <= maxX && y >= minY && y <= maxY;
            if (distance <= 5 && bbHit) {
              return i;
            }
          }
        }
      }
      return null;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
    };
  }, [currentTool, history, historyIndex, id, updateAnnotations, drawAnnotations]);

  React.useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z') {
          if (historyIndex > 0) {
            setHistoryIndex(historyIndex - 1);
            updateAnnotations(id, history[historyIndex - 1]);
          }
        } else if (e.key === 'y') {
          if (historyIndex < history.length - 1) {
            setHistoryIndex(historyIndex + 1);
            updateAnnotations(id, history[historyIndex + 1]);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, historyIndex, id, updateAnnotations]);

  const onResize = (event, { size }) => {
    setCurrentWidth(size.width);
    setCurrentHeight(size.height);
    if (chart.current) {
      chart.current.resize(size.width, size.height - TOOLBAR_HEIGHT, true);
    }
    if (canvasRef.current) {
      canvasRef.current.width = size.width;
      canvasRef.current.height = size.height - TOOLBAR_HEIGHT;
    }
    requestAnimationFrame(() => drawAnnotations());
  };

  const onResizeStop = (event, { size }) => {
    resizeChart(id, size.width, size.height);
  };

  const [{ isDragging }, drag] = useDrag({
    type: CHART_TYPE,
    item: { id, left, top, width, height },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  const tools = [
    { name: 'line', label: 'Линия' },
    { name: 'rectangle', label: 'Прямоугольник' },
    { name: 'text', label: 'Текст' },
    { name: 'eraser', label: 'Ластик' },
    { name: 'clear', label: 'Очистить' },
  ];

  const handleToolClick = (tool) => {
    if (tool === 'clear') {
      const newAnnotations = [];
      const newHistory = [...history.slice(0, historyIndex + 1), newAnnotations];
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
      updateAnnotations(id, newAnnotations);
      setCurrentTool(null);
    } else {
      setCurrentTool(currentTool === tool ? null : tool);
    }
  };

  return (
    <Resizable
      width={currentWidth}
      height={currentHeight}
      onResize={onResize}
      onResizeStop={onResizeStop}
      minConstraints={[200, 200]}
      resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 'n', 's']}
    >
      <div style={{ position: 'absolute', left, top, opacity: isDragging ? 0.5 : 1, border: '1px solid gray', width: currentWidth, height: currentHeight, background: 'white' }}>
        <div ref={drag} style={{ height: TOOLBAR_HEIGHT, display: 'flex', background: '#f0f0f0', padding: 5, cursor: 'move' }}>
          {tools.map(tool => (
            <button
              key={tool.name}
              onClick={() => handleToolClick(tool.name)}
              style={{
                marginRight: 5,
                background: currentTool === tool.name ? '#DFDFDF' : 'white',
              }}
            >
              {tool.label}
            </button>
          ))}
        </div>
        <div style={{ position: 'relative', width: '100%', height: `calc(100% - ${TOOLBAR_HEIGHT}px)` }}>
          <div ref={chartRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 1 }} />
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              zIndex: 2,
              pointerEvents: currentTool ? 'auto' : 'none',
            }}
          />
        </div>
      </div>
    </Resizable>
  );
};

const InfiniteGrid = () => {
  const [charts, setCharts] = React.useState(() => {
    const saved = localStorage.getItem('charts');
    if (saved) return JSON.parse(saved);
    return [
      { id: 1, left: 0, top: 0, width: 400, height: 330, annotations: [] },
      { id: 2, left: 400, top: 0, width: 400, height: 330, annotations: [] },
      { id: 3, left: 0, top: 330, width: 400, height: 330, annotations: [] },
      { id: 4, left: 400, top: 330, width: 400, height: 330, annotations: [] },
    ];
  });

  React.useEffect(() => {
    localStorage.setItem('charts', JSON.stringify(charts));
  }, [charts]);

  const moveChart = (id, left, top, newWidth, newHeight) => {
    setCharts((prev) => prev.map((chart) => (chart.id === id ? { ...chart, left, top, width: newWidth, height: newHeight } : chart)));
  };

  const resizeChart = (id, width, height) => {
    setCharts((prev) => prev.map((chart) => (chart.id === id ? { ...chart, width, height } : chart)));
  };

  const updateAnnotations = (id, annotations) => {
    setCharts((prev) => prev.map((chart) => (chart.id === id ? { ...chart, annotations } : chart)));
  };

  const [, drop] = useDrop({
    accept: CHART_TYPE,
    drop(item, monitor) {
      const delta = monitor.getDifferenceFromInitialOffset();
      let newLeft = Math.round(item.left + delta.x);
      let newTop = Math.round(item.top + delta.y);

      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const cellWidth = Math.floor(viewportWidth / 2);
      const cellHeight = Math.floor(viewportHeight / 2);
      newLeft = Math.round(newLeft / cellWidth) * cellWidth;
      newTop = Math.round(newTop / cellHeight) * cellHeight;

      newLeft = Math.max(0, Math.min(newLeft, viewportWidth - cellWidth));
      newTop = Math.max(0, Math.min(newTop, viewportHeight - cellHeight));

      const newWidth = cellWidth;
      const newHeight = cellHeight;

      moveChart(item.id, newLeft, newTop, newWidth, newHeight);
      return undefined;
    },
  });

  React.useEffect(() => {
    const handleResize = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const cellWidth = Math.floor(viewportWidth / 2);
      const cellHeight = Math.floor(viewportHeight / 2);
      setCharts((prev) => prev.map((chart) => ({
        ...chart,
        width: cellWidth,
        height: cellHeight,
        left: Math.round(chart.left / cellWidth) * cellWidth,
        top: Math.round(chart.top / cellHeight) * cellHeight,
      })));
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return <div ref={drop} style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'auto' }}>
    <div style={{ position: 'absolute', top: 0, left: '50%', width: '1px', height: '100%', background: '#ccc', zIndex: 0 }} />
    <div style={{ position: 'absolute', top: '50%', left: 0, height: '1px', width: '100%', background: '#ccc', zIndex: 0 }} />
    {charts.map((chart) => (
      <DraggableResizableChart
        key={chart.id}
        id={chart.id}
        left={chart.left}
        top={chart.top}
        width={chart.width}
        height={chart.height}
        annotations={chart.annotations}
        moveChart={moveChart}
        resizeChart={resizeChart}
        updateAnnotations={updateAnnotations}
      />
    ))}
  </div>;
};

const RootApp = () => {
  return <DndProvider backend={HTML5Backend}>
    <InfiniteGrid />
  </DndProvider>;
};

const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<RootApp />);
} else {
  console.error('Root element not found');
}