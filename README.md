# AI Recruiting Workflow

Submit one text-based PDF resume, a job description, and up to eight hiring-team names. The n8n form returns a ZIP with an editable Word resume, one DM draft per unique name, and a resume review report. The Gmail node is disabled and disconnected. Review and send drafts manually.

## Run locally on a Mac

1. Start [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/) and install and open [Ollama for macOS](https://docs.ollama.com/macos). Keep Ollama running. This project uses your Mac for inference and requires no Claude key or paid API.
2. Keep `compose.yaml` and `recruiting-workflow.json` together. In Terminal, change to that folder and run:

   ```sh
   ollama pull qwen2.5:3b
   docker compose up -d
   ```

   The model download is about 1.9 GB. The initial image and model downloads need internet access.
3. Open [the local n8n editor](http://localhost:5678), set up the local owner account if prompted, and create a blank workflow. Use the editor’s **⋯ → Import from File** menu to import `recruiting-workflow.json`. Save it.
4. Select **Application Form**, then click **Execute step** to open its test form. Upload a PDF with selectable text, paste the job description, and enter names such as `Riley Chen, Jordan Singh`. Leave the tab open while the two drafts generate. The browser should download `application-drafts.zip` automatically. Check Downloads, unzip it, and review the files. For repeated use, publish the workflow and open the **Production URL** listed on the trigger.

## What runs

| Nodes | Purpose |
| --- | --- |
| Application Form → Extract Resume PDF | Accepts the webhook-backed form and extracts text using n8n’s built-in PDF reader. |
| Tailor Resume and Draft Outreach | Separate Ollama calls. The resume prompt uses temperature 0.3 and anchors claims to the source. The outreach prompt uses 0.7 and anchors each DM to the job and a verified resume detail. Both use JSON schemas. |
| Wait for Both Drafts → Validate and Package | Joins the two branches, parses the JSON, validates recipient coverage, and creates the Word resume and text drafts. |
| Download Drafts | Returns the ZIP from the form. |
| Gmail Send (Disabled) | Disconnected placeholder with no credentials. |

The calls are independent workflow branches. n8n’s v1 execution order can run branches sequentially, so allow time for both. The Word file uses a single-column, text-first layout. Review the wording, facts, dates, metrics, and contact details before sharing it. Model output is a draft, and JSON validation checks structure and recipient coverage.

## Your resume rules

The resume uses 10-point black Times New Roman, justified single-column text, US Letter paper, 0.6-inch margins, and uppercase headings. The filename follows `Prithvi_HL_Job_Title_Company_Name.docx`. The report in `resume-review.txt` lists the job description’s keywords and review items such as citizenship language or missing qualifications. It stays out of the resume. The prompt targets two pages. Check the final page count in Word, where pagination depends on the submitted content.

The model follows the uploaded resume’s visible section hierarchy, line breaks, blank lines, and indentation where PDF extraction retains those cues. The generator preserves the line breaks and indentation returned by the model. PDF text extraction does not pass through exact heading sizes, spacing measurements, or tab stops, so the Word file uses the configured typography and spacing.

If you have an older copy imported, create a fresh workflow and import the updated JSON. If you switch the new copy to production, unpublish the previous workflow first so the two workflows do not compete for the same form path.

## Troubleshooting

- **Completion page has no download button** — n8n starts the download automatically. Check the browser’s Downloads and Finder → Downloads for `application-drafts.zip`. If the download was blocked, retry the form in Chrome or Safari. If the test run is still open in the editor, open **Validate and Package → Output → Binary** and use **Download** on `bundle`.

- **Ollama connection refused** — Check that the Ollama app is running and that `curl http://localhost:11434/api/tags` responds on the Mac. The Docker container reaches it at `host.docker.internal`. If you installed n8n directly on the Mac, change both HTTP Request URLs to `http://localhost:11434/api/chat`.
- **Model not found** — Run `ollama pull qwen2.5:3b`. If you change the model, use the same tag in both HTTP Request nodes.
- **PDF has no selectable text** — Export the source document as a PDF with text, or run OCR on the scan first. Save Word inputs as PDF before uploading. The combined resume and job description limit is 16,000 characters.
- **Need to inspect a run** — While testing, inspect node results in the workflow editor. The export is configured to skip saving execution history by default because it contains resume data.
- **Stop the local service** — Run `docker compose stop` from the same folder. The local n8n volume retains your account and workflow.


## Project structure

| Path | Purpose |
| --- | --- |
| `recruiting-workflow.json` | Importable workflow with the form, both Ollama prompts, validation, packaging, and a disabled Gmail node. |
| `compose.yaml` | Starts local n8n on port 5678. |
| `scripts/build-workflow.py` | Builds the workflow export and embeds the JavaScript Code node. The resume and outreach prompts are defined here. |
| `scripts/build-output.js` | Validates model JSON, generates the Word document, and packages it together with the outreach and review text. |
| `scripts/check-workflow.js` | Uses mock model responses to check request generation, filename and formatting rules, recipient coverage, and output packaging. |

## Develop and verify

From the repository root, run:

```sh
python3 scripts/build-workflow.py
node scripts/check-workflow.js
unzip -t .artifacts/example-bundle.zip
docker compose config --quiet
```

The check writes a synthetic ZIP under the ignored `.artifacts/` directory. It requires no model or API credentials. Use the form with Ollama running to check the complete workflow. Resume PDFs and output drafts contain personal data and should stay out of the repository.
