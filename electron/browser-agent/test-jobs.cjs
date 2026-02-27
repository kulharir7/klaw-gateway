const upwork = require('./upwork');
const browser = require('./browser');

async function test() {
  console.log('=== JOB SEARCH TEST (Indeed) ===\n');

  const jobs = await upwork.searchJobsPublic('react developer', 'remote');
  
  console.log(`Found ${jobs.length} jobs!\n`);
  
  jobs.slice(0, 10).forEach((job, i) => {
    console.log(`[${i + 1}] ${job.title}`);
    console.log(`    Company: ${job.company}`);
    console.log(`    Location: ${job.location}`);
    console.log(`    Desc: ${job.description.substring(0, 100)}...`);
    console.log(`    Link: ${job.link.substring(0, 80)}`);
    console.log();
  });

  await browser.close();
  console.log('=== DONE ===');
}

test().catch(e => {
  console.error('❌', e.message);
  browser.close().catch(() => {});
  process.exit(1);
});
