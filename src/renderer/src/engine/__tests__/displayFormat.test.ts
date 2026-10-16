import {
  formatAirflow, formatLoad, formatLength, formatDuctSize, formatVelocity, formatPressure, formatArea
} from '../../format/units';

function eq(actual: string, expected: string): void {
  if (actual !== expected) throw new Error(`Expected "${expected}" got "${actual}"`);
}

console.log('=== Running Display Format Test ===');
eq(formatAirflow(123, 'imperial'), '123 CFM');
eq(formatAirflow(123, 'metric'), '58 L/s');
eq(formatAirflow(1581.5320319999998, 'imperial'), '1,582 CFM');
eq(formatLoad(22186, 'imperial'), '22,186 Btu/h');
eq(formatLoad(22186, 'metric'), '6.50 kW');
eq(formatLength(10, 'imperial'), '10.0 ft');
eq(formatLength(10, 'metric'), '3.05 m');
eq(formatDuctSize(14, 10, 'imperial'), '14"x10"');
eq(formatDuctSize(14, 10, 'metric'), '350x250 mm');
eq(formatVelocity(1000, 'imperial'), '1,000 FPM');
eq(formatVelocity(1000, 'metric'), '5.1 m/s');
eq(formatPressure(0.5, 'imperial'), '0.500 in.wg');
eq(formatPressure(0.5, 'metric'), '125 Pa');
eq(formatArea(1076.39, 'metric'), '100 m²');
eq(formatAirflow(NaN, 'metric'), '—');
console.log('Display format: PASS');
