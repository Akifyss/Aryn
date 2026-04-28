import React, { useEffect, useState } from 'react';

const TimeZoneClock = () => {
  const [timeZones, setTimeZones] = useState(['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo']);
  const [selectedZone, setSelectedZone] = useState('UTC');
  const [time, setTime] = useState('');

  const updateTime = () => {
    const date = new Date();
    const options = { timeZone: selectedZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
    setTime(new Intl.DateTimeFormat('en-US', options).format(date));
  };

  useEffect(() => {
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, [selectedZone]);

  return (
    <div className="p-4 bg-gray-100 rounded-lg shadow-md">
      <h1 className="text-xl font-bold mb-2">Digital Clock</h1>
      <div className="mb-4">
        <select
          className="border rounded p-2"
          value={selectedZone}
          onChange={(e) => setSelectedZone(e.target.value)}
        >
          {timeZones.map((zone, index) => (
            <option key={index} value={zone}>{zone}</option>
          ))}
        </select>
      </div>
      <div className="text-3xl font-mono">
        {time}
      </div>
    </div>
  );
};

export default TimeZoneClock;
