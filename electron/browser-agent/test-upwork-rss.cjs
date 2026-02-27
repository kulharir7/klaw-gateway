const upwork = require('./upwork');

async function test() {
  console.log('=== UPWORK RSS JOB SEARCH TEST ===\n');

  console.log('Searching for "react developer" jobs...\n');
  const jobs = await upwork.searchJobsRSS('react developer');

  console.log(`Found ${jobs.length} jobs!\n`);
  
  jobs.slice(0, 5).forEach((job, i) => {
    console.log(`[${i + 1}] ${job.title}`);
    console.log(`    Budget: ${job.budget || 'Not specified'}`);
    console.log(`    Skills: ${job.skills || 'None listed'}`);
    console.log(`    Posted: ${job.published}`);
    console.log(`    Link: ${job.link}`);
    console.log(`    Desc: ${job.description.substring(0, 150)}...`);
    console.log();
  });
}

test().catch(e => {
  console.error('❌ Failed:', e.message);
  process.exit(1);
});
