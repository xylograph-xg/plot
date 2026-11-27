import { writeFile } from 'node:fs/promises';

const columns = Array.from({ length: 10 }, (_, index) => 'Col' + (index + 1));

for (const count of [10_000, 15_000, 100_000]) {
  const lines = [columns.join(',')];
  for (let row = 0; row < count; row += 1) {
    const x = row / 1000;
    lines.push([x.toFixed(3), ...columns.slice(1).map((_, column) =>
      (2 * Math.exp(-x / (column + 1)) + 3 * Math.exp(-x / (column + 3)) + column).toFixed(6))].join(','));
  }
  const file = new URL(`./${count}x10.csv`, import.meta.url);
  await writeFile(file, lines.join('\n') + '\n');
  console.log(file.pathname);
}
