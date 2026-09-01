const options = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const [key, ...parts] = argument.replace(/^--/, '').split('=');
  return [key, parts.join('=')];
}));
for (const required of ['latitude', 'longitude', 'start-date', 'end-date', 'start-hour']) {
  if (!options[required]) throw new Error(`Argument manquant: --${required}`);
}
const query = new URLSearchParams({
  latitude: options.latitude, longitude: options.longitude,
  start_date: options['start-date'], end_date: options['end-date'],
  hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m',
  timezone: 'Europe/Paris', wind_speed_unit: 'kmh',
});
const response = await fetch(`https://archive-api.open-meteo.com/v1/archive?${query}`);
if (!response.ok) throw new Error(`Open-Meteo archive: ${response.status}`);
const data = await response.json();
const startHour = Number(options['start-hour']);
const hourly = data.hourly;
const weatherSeries = hourly.temperature_2m.map((temperature, index) => ({
  hourFromStart: index - startHour,
  temperature,
  humidity: hourly.relative_humidity_2m[index],
  windKph: hourly.wind_speed_10m[index],
  // The API reports where the wind comes from; the engine wants the bearing the front is pushed along.
  windBearingDegrees: (hourly.wind_direction_10m[index] + 180) % 360,
}));
process.stdout.write(`${JSON.stringify({
  source: 'Open-Meteo Historical Weather API', license: 'CC BY 4.0',
  latitude: Number(options.latitude), longitude: Number(options.longitude),
  startDate: options['start-date'], endDate: options['end-date'], startHour,
  weatherSeries,
})}\n`);
