// A stand-in scraper for the admin tests: prints, waits a moment, prints again, exits 0.
console.log('line one');
console.error('a warning');
await new Promise((r) => setTimeout(r, 300));
process.stdout.write('line two (no newline at the end)');
