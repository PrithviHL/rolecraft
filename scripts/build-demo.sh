#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
unzip -tq web/sample-application.zip
unzip -p web/sample-application.zip outreach-drafts.txt > web/outreach-drafts.txt
unzip -p web/sample-application.zip resume-review.txt > web/resume-review.txt
