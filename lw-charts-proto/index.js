import React from 'react';
import ReactDOM from 'react-dom/client';
import { createChart } from 'lightweight-charts';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { Resizable } from 'react-resizable';
import 'react-resizable/css/styles.css';

const CHART_TYPE = 'chart';

const DraggableResizableChart = ({ id, left, top, width, height, moveChart, resizeChart }) => {
  const chartRef = React.useRef(null);

  const [{ isDragging }, drag] = useDrag({
    type: CHART_TYPE,
    item: { id, left, top },
    collect: (monitor) => ({ isDragging: monitor.isDragging() }),
  });

  React.useEffect(() => {
    if (chartRef.current) {
      const chart = createChart(chartRef.current, { width, height });
      const candleSeries = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350' });

      // Генерация 10k свечей
      const data = [];
      let time = Date.now() / 1000 - 10000 * 3600;
      let lastClose = 100;
      for (let i = 0; i < 10000; i++) {
        const open = lastClose;
        const high = open + Math.random() * 10;
        const low = open - Math.random() * 10;
        const close = open + (Math.random() - 0.5) * 5;
        data.push({ time, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close });
        time += 3600;
        lastClose = close;
      }
      candleSeries.setData(data);

      // Drawing: Линия
      const lineSeries = chart.addLineSeries({ color: '#FF0000', lineWidth: 2 });
      lineSeries.setData(data.map(d => ({ time: d.time, value: d.close + 10 })));

      chart.resize(width, height); // Обновление размера

      return () => chart.remove();
    }
  }, [width, height]);

  const onResize = (event, { size }) => {
    resizeChart(id, size.width, size.height);
  };

  return (
    <Resizable
      width={width}
      height={height}
      onResize={onResize}
      minConstraints={[200, 200]}
      resizeHandles={['se', 'sw', 'ne', 'nw', 'e', 'w', 'n', 's']} // Хэндлы на всех сторонах
    >
      <div ref={drag} style={{ position: 'absolute', left, top, opacity: isDragging ? 0.5 : 1, border: '1px solid gray', width, height, background: 'white', cursor: 'move' }}> // Drag по всему окну
        <div ref={chartRef} style={{ width: '100%', height: '100%' }} /> // Чарт на весь
      </div>
    </Resizable>
  );
};

const InfiniteGrid = () => {
  const [charts, setCharts] = React.useState([{ id: 1, left: 0, top: 0, width: 400, height: 300 }]);

  const moveChart = (id, left, top) => {
    setCharts((prev) => prev.map((chart) => (chart.id === id ? { ...chart, left, top } : chart)));
  };

  const resizeChart = (id, width, height) => {
    setCharts((prev) => prev.map((chart) => (chart.id === id ? { ...chart, width, height } : chart)));
  };

  const [, drop] = useDrop({
    accept: CHART_TYPE,
    drop(item, monitor) {
      const delta = monitor.getDifferenceFromInitialOffset();
      const left = Math.round(item.left + delta.x);
      const top = Math.round(item.top + delta.y);
      moveChart(item.id, left, top);
      return undefined;
    },
  });

  return <div ref={drop} style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'auto' }}> // Drop on grid, auto scroll
    {charts.map((chart) => (
      <DraggableResizableChart key={chart.id} id={chart.id} left={chart.left} top={chart.top} width={chart.width} height={chart.height} moveChart={moveChart} resizeChart={resizeChart} />
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