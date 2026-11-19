const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const workflow = JSON.parse(fs.readFileSync(path.join(root, 'recruiting-workflow.json')));
const byName = Object.fromEntries(workflow.nodes.map(node => [node.name, node]));
assert.equal(workflow.nodes.length, 8);
assert.equal(byName['Gmail Send (Disabled)'].disabled, true);
assert(!JSON.stringify(workflow.connections).includes('Gmail'));
const inputs = { text: 'Alex Rivera — Data Analyst. Built SQL reports and reduced weekly reporting time by 20%.', job: 'Example & Co. seeks a Data Analyst to improve reporting with SQL. US citizenship required.', team: 'Riley Chen,\nJordan Singh, Riley Chen' };
const request = name => {
  const body = byName[name].parameters.body;
  const expression = /^=\{\{([\s\S]*?)\}\}$/.exec(body);
  assert(expression, 'Expected one expression covering the request body');
  assert(!expression[1].includes('}}'), 'n8n would close the expression early');
  return new Function('$json', 'return ' + expression[1])(inputs);
};
const resumeRequest = JSON.parse(request('Tailor Resume'));
const outreachRequest = JSON.parse(request('Draft Outreach'));
assert.equal(resumeRequest.options.temperature, 0.3);
assert.equal(outreachRequest.options.temperature, 0.7);
assert.equal(JSON.parse(outreachRequest.messages[1].content).recipients.length, 2);
const results = {
  'Application Form': inputs,
  'Tailor Resume': { done: true, message: { content: JSON.stringify({
    job_title: 'Data Analyst', company_name: 'Example & Co.', ats_keywords: { hard_skills_tools: ['SQL'] }, review_notes: [], name: 'Alex Rivera', contact: 'alex@example.com | Portland, OR', sections: [
      { heading: 'Summary', lines: ['Data analyst with experience building SQL reports and improving reporting workflows.'] },
      { heading: 'Experience', lines: ['Data Analyst | Example & Co. | 2022–Present', '\n  • Built SQL reports that reduced weekly reporting time by 20%.'] },
      { heading: 'Certifications', lines: ['Example Certificate'] },
      { heading: 'Skills', lines: ['SQL, reporting, data analysis'] },
    ],
  }) } },
  'Draft Outreach': { done: true, message: { content: JSON.stringify({ messages: [
    { recipient_id: 2, message: 'I’m interested in the Data Analyst role. I built SQL reports that cut weekly reporting time by 20%. Would you be open to sharing which reporting needs the team is tackling first?' },
    { recipient_id: 1, message: 'The Data Analyst role caught my eye because I’ve used SQL to reduce weekly reporting time by 20%. Could I ask what strong performance in the role looks like in the first few months?' },
  ] }) } },
};
const run = () => new Function('$', byName['Validate and Package'].parameters.jsCode)(
  name => ({ first: () => ({ json: results[name] }) }),
)[0];
const output = run();
assert.deepEqual(output.json.outreach.map(draft => draft.name), ['Riley Chen', 'Jordan Singh']);
assert.equal(output.json.resumeFilename, 'Prithvi_HL_Data_Analyst_Example_Co.docx');
assert.equal(output.json.resume.sections.at(-1).heading, 'CERTIFICATIONS');
assert.match(output.json.reviewNotes[0], /citizenship/);
assert.deepEqual(output.json.resume.sections[1].lines.slice(1), [
  '', '  - Built SQL reports that reduced weekly reporting time by 20%.',
]);
fs.mkdirSync(path.join(root, '.artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, '.artifacts/example-bundle.zip'), Buffer.from(output.binary.bundle.data, 'base64'));
const message = JSON.parse(results['Draft Outreach'].message.content);
message.messages[0].recipient_id = 1;
results['Draft Outreach'].message.content = JSON.stringify(message);
assert.throws(run, /duplicate/);
results['Draft Outreach'].message.content = '{';
assert.throws(run, /invalid JSON/);
console.log('Passed workflow structure, request expressions, output packaging and failure cases.');
