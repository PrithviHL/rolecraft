const loadButton = document.querySelector('#load');
const results = document.querySelector('#results');
const status = document.querySelector('#status');

async function readSample(filename, target) {
  const response = await fetch(filename);
  if (!response.ok) throw new Error('Sample unavailable');
  const text = await response.text();
  const paragraph = document.createElement('p');
  paragraph.textContent = text.trim();
  target.replaceChildren(paragraph);
}

loadButton.addEventListener('click', async () => {
  loadButton.disabled = true;
  status.textContent = 'Loading sample results…';
  try {
    await Promise.all([
      readSample('./outreach-drafts.txt', document.querySelector('#messages')),
      readSample('./resume-review.txt', document.querySelector('#review')),
    ]);
    results.hidden = false;
    status.textContent = 'Sample results for Alex Rivera.';
  } catch {
    status.textContent = 'Could not load the sample. Try again.';
    loadButton.disabled = false;
  }
});

document.querySelector('#copy').addEventListener('click', async () => {
  const status = document.querySelector('#copy-status');
  try {
    await navigator.clipboard.writeText(document.querySelector('#commands').textContent);
    status.textContent = 'Commands copied.';
  } catch {
    status.textContent = 'Select the command text to copy it manually.';
  }
});
