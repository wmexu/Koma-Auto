import { Files } from 'files-sdk';
import { neon } from 'files-sdk/neon';

async function main() {
  console.log('Testing Neon Object Storage (bucket: assets)...');
  console.log('Endpoint:', process.env.AWS_ENDPOINT_URL_S3);
  console.log('Region:', process.env.AWS_REGION);

  try {
    const files = new Files({
      adapter: neon({
        bucket: 'assets',
      }),
    });

    const testPath = 'test/ping.txt';
    const testData = `Neon Object Storage test at ${new Date().toISOString()}`;

    console.log(`1. Uploading test file to ${testPath}...`);
    await files.upload(testPath, testData, { contentType: 'text/plain' });
    console.log('Upload successful!');

    console.log(`2. Checking existence of ${testPath}...`);
    const exists = await files.exists(testPath);
    console.log('File exists:', exists);

    console.log(`3. Downloading test file...`);
    const downloaded = await files.download(testPath);
    const content = await downloaded.text();
    console.log('Downloaded content:', content);

    console.log(`4. Generating signed/direct URL...`);
    const url = await files.url(testPath);
    console.log('URL:', url);

    console.log('\nNeon Object Storage test PASSED!\n');
  } catch (err) {
    console.error('Storage test failed:', err);
    process.exit(1);
  }
}

main();
