import Database from 'better-sqlite3';
const db = new Database('./data/database.db');
const rows = db.prepare('SELECT id, text FROM platform_posts WHERE platform=? ORDER BY id DESC LIMIT 3').all('shafa');
console.log('Found:', rows.length, 'rows');
for (const r of rows) {
  console.log('--- ID:', r.id);
  try {
    const j = JSON.parse(r.text);
    console.log('  style:', JSON.stringify(j.style));
    console.log('  print:', JSON.stringify(j.print));
  } catch {
    console.log('  raw text:', r.text.slice(0, 120));
  }
}
db.close();
