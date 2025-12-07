
const fs = require('fs');

async function run() {
    const url = 'https://www.sejm.gov.pl/SQL2.nsf/poskomprocall?OpenAgent&10&1175';
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7'
            }
        });
        if (!res.ok) {
            console.error('Status:', res.status, res.statusText);
            return;
        }
        const text = await res.text();
        fs.writeFileSync('sejm_extra.html', text);
        console.log('Saved ' + text.length + ' bytes to sejm_extra.html');
    } catch (e) {
        console.error(e);
    }
}
run();
