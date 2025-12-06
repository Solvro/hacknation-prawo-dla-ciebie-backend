
const https = require('https');

const url = "https://www.sejm.gov.pl/SQL2.nsf/poskomprocall?OpenAgent&10&1630";

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    console.error('Error parsing JSON. Raw data:', data);
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

fetchUrl(url).then(data => {
    console.log(JSON.stringify(data, null, 2));
}).catch(console.error);
