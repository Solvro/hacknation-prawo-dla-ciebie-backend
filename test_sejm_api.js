
const https = require('https');

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    console.error('Error parsing JSON:', data.substring(0, 100)); // Log text if not JSON
                    resolve(data);
                }
            });
        }).on('error', reject);
    });
}

async function run() {
    try {
        console.log('--- Process 89 (example) ---');
        // Process 89 usually has some activity
        const process = await fetchUrl('https://api.sejm.gov.pl/sejm/term10/processes/89');
        console.log(JSON.stringify(process, null, 2));

        if (process.stages) {
            for (const stage of process.stages) {
                if (stage.children) {
                    for (const child of stage.children) {
                        if (child.voting) {
                            console.log('\n--- Found Voting in Stage ---');
                            console.log(child.voting);
                            // It's likely just summary stats. Check if we can find date/sitting to query specific voting API.
                            // The process object in Sejm API usually links to votings via date/sitting in stages.
                            if (stage.sittingNum && child.voting) {
                                console.log(`Searching for voting details for sitting ${stage.sittingNum} on date ${child.date}...`);
                                // There isn't a direct link ID here usually, we have to search in votings endpoint or prints.
                                // But let's check prints first.
                            }
                        }
                    }
                }
            }
        }

        // Let's check a voting endpoint to see structure
        console.log('\n--- Sample Voting (Sitting 1, Voting 1) ---');
        const voting = await fetchUrl('https://api.sejm.gov.pl/sejm/term10/votings/1/1');
        console.log(JSON.stringify(voting, null, 2));

    } catch (error) {
        console.error('Error:', error);
    }
}

run();
