# RoleCraft

RoleCraft tailors a Word resume to a job description and prepares a personalized outreach draft for each named hiring-team contact. One submission returns a ZIP containing the tailored `.docx`, `outreach-drafts.txt`, and `resume-review.txt`.

## Try the public demo

Explore a fictional application and download a complete sample ZIP. The public site displays sample data. Real resumes are processed locally with n8n and Ollama. [RoleCraft demo](https://rolecraft-atr5.onrender.com/)

## Run locally on a Mac

1. Install Git, Docker Desktop, and Ollama. Start Docker Desktop and Ollama.
2. Run:

   ```sh
   git clone https://github.com/PrithviHL/rolecraft.git
   cd rolecraft
   ollama pull qwen2.5:3b
   docker compose up -d
   ```

3. Open [local n8n](http://localhost:5678/), complete the local owner setup if prompted, and create a workflow. Choose **Import from File**, select `recruiting-workflow.json`, and save.
4. Click **Execute workflow** to open the test form. Upload an editable **Word .docx** under 5 MB, paste the job description, and enter up to eight hiring-team names separated by commas or new lines.
5. Open the downloaded ZIP and review the resume and outreach drafts before sending. Publish the workflow to use the production form.

## How it works

- The local template service reads the Word document and preserves its styles, margins, heading sizes, tabs, links, and bullet formatting. It highlights matching source skills and ranks recognized experience bullets and projects against the job description. Reordering and filtering can shift page breaks.
- n8n sends resume text and the job description to local Ollama for structured review and outreach. The Word document uses source-backed text and formatting. Gmail is disabled and disconnected.
- The production form accepts `.docx` only. A PDF must be converted to an editable Word document before upload. Use the original Word file when available.

## Project files

- `recruiting-workflow.json` is the importable n8n workflow.
- `compose.yaml` launches n8n and the Word template service. Only n8n exposes a local port.
- `scripts/template_service.py` handles Word extraction and formatting-preserving tailoring.
- `web/` contains the public demo and its fictional sample ZIP. `render.yaml` specifies the Render static-site build.

Run `docker compose config --quiet` to validate Compose and `bash scripts/build-demo.sh` to verify and unpack the public sample assets. Keep personal resumes and drafts outside version control.
