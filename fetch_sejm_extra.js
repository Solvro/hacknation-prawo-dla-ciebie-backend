
const axios = require('axios');
const fs = require('fs');

const url = 'https://www.sejm.gov.pl/SQL2.nsf/poskomprocall?OpenAgent&10&1175';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
};

axios.get(url, { headers })
    .then(response => {
        console.log('Status:', response.status);
        fs.writeFileSync('sejm_extra_data.html', response.data);
        console.log('Saved to sejm_extra_data.html');
    })
    .catch(error => {
        console.error('Error:', error.message);
        if (error.response) {
            console.error('Response status:', error.response.status);
        }
    });
