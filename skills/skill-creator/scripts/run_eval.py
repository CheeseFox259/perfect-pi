#!/usr/bin/env python3
"""Run trigger evaluation for a skill description.

Tests whether a skill's description causes Pi to trigger (read the skill)
for a set of queries. Outputs results as JSON.

Evaluation runs Pi in JSON mode with:
- Non-interactive ephemeral mode (-p --no-session)
- Isolated skills (--no-skills --skill <path>)
- Read-only tools allowlist (--tools read), MCP/extension isolation (--no-mcp --no-extensions)
- No ambient project instructions (--no-context-files)
- Safe argument separator (--) before arbitrary query strings
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from scripts.utils import parse_skill_md, session_model


def find_project_root() -> Path:
    """Find the project root by walking up from cwd looking for .pi/ or .git/."""
    current = Path.cwd()
    for parent in [current, *current.parents]:
        if (parent / ".pi").is_dir() or (parent / ".git").is_dir():
            return parent
    return current


def is_candidate_skill_read(
    tool_name: str,
    args: dict | None,
    candidate_skill_file: Path,
    candidate_skill_dir: Path,
    project_root: Path,
) -> bool:
    """Check whether a tool invocation is calling the read tool on the candidate skill.

    Requires exact tool name 'read' (read-only tool allowlist) and verifies that
    the target path resolves to candidate SKILL.md or candidate skill directory.
    """
    if tool_name != "read" or not isinstance(args, dict):
        return False
    raw_path = args.get("path")
    if not isinstance(raw_path, str) or not raw_path.strip():
        return False
    try:
        target_file = candidate_skill_file.resolve()
        p = Path(raw_path).expanduser()
        resolved_p = (p if p.is_absolute() else project_root / p).resolve()
        if resolved_p == target_file:
            return True
    except Exception:
        return False
    return False


def run_single_query(
    query: str,
    skill_name: str,
    skill_description: str,
    timeout: int,
    project_root: str,
    model: str | None = None,
) -> dict:
    """Run a single query and return trigger status and any error encountered.

    Creates an ephemeral skill with --skill so it appears in Pi's
    available skills, then runs Pi with `--tools read --no-mcp --no-extensions`
    and `--no-context-files --no-skills --skill <dir> -- <query>`
    with closed stdin.

    Detects triggering from Pi's JSON event stream when the agent calls `read`
    specifically on candidate SKILL.md.
    Distinguishes provider/process/timeout errors from clean negative triggers.
    """
    unique_id = uuid.uuid4().hex[:8]
    clean_name = f"{skill_name}-skill-{unique_id}"
    temp_dir = Path(tempfile.mkdtemp(prefix="pi-skill-eval-"))
    skill_dir = temp_dir / clean_name
    command_file = skill_dir / "SKILL.md"
    project_root_path = Path(project_root).resolve()

    try:
        skill_dir.mkdir(parents=True, exist_ok=True)
        indented_desc = "\n  ".join(skill_description.split("\n"))
        command_content = (
            f"---\n"
            f"name: {clean_name}\n"
            f"description: |\n"
            f"  {indented_desc}\n"
            f"---\n\n"
            f"# {skill_name}\n\n"
            f"This skill handles: {skill_description}\n"
        )
        command_file.write_text(command_content)

        pi_bin = os.environ.get("PI_BIN", "pi")
        cmd = [
            pi_bin,
            "--mode", "json",
            "-p",
            "--no-session",
            "--tools", "read",
            "--no-mcp",
            "--no-extensions",
            "--no-context-files",
            "--no-skills",
            "--skill", str(skill_dir),
        ]
        model = session_model(model)
        if model:
            cmd.extend(["--model", model])
        # Use '--' to safely pass arbitrary query strings starting with '-'
        cmd.extend(["--", query])

        env = os.environ.copy()

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            cwd=str(project_root_path),
            env=env,
            text=True,
        )

        timed_out = False
        stdout = ""
        stderr = ""
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            process.kill()
            try:
                stdout, stderr = process.communicate(timeout=5)
            except Exception:
                stdout, stderr = "", ""

        if timed_out:
            return {
                "triggered": False,
                "error": f"Execution timed out after {timeout} seconds",
                "error_type": "timeout",
            }

        triggered = False
        api_error = None
        saw_assistant = False

        # Parse all buffered JSON events, including final lines without trailing newline
        lines = stdout.splitlines()
        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue

            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue

            if not isinstance(event, dict):
                continue

            event_type = event.get("type")

            # 1. Direct error event
            if event_type == "error":
                api_error = event.get("message") or event.get("error") or "API error event"

            # 2. Assistant message stream update
            elif event_type == "message_update":
                ame = event.get("assistantMessageEvent", {})
                if isinstance(ame, dict):
                    if ame.get("stopReason") in ("error", "aborted"):
                        api_error = ame.get("errorMessage") or f"Assistant error: {ame.get('stopReason')}"
                    if ame.get("type") == "toolcall_end":
                        tool_call = ame.get("toolCall", {})
                        if isinstance(tool_call, dict):
                            t_name = tool_call.get("name", "")
                            t_args = tool_call.get("arguments", {})
                            if is_candidate_skill_read(t_name, t_args, command_file, skill_dir, project_root_path):
                                triggered = True

            # 3. Tool execution start
            elif event_type == "tool_execution_start":
                t_name = event.get("toolName", "")
                t_args = event.get("args", {})
                if is_candidate_skill_read(t_name, t_args, command_file, skill_dir, project_root_path):
                    triggered = True

            # 4. Message end with content array
            elif event_type == "message_end":
                msg = event.get("message", {})
                if isinstance(msg, dict):
                    if msg.get("role") == "assistant":
                        saw_assistant = True
                    stop_reason = msg.get("stopReason")
                    if stop_reason in ("error", "aborted"):
                        api_error = msg.get("errorMessage") or f"Message stopped with reason: {stop_reason}"
                    for content_item in msg.get("content", []):
                        if isinstance(content_item, dict) and content_item.get("type") == "toolCall":
                            t_name = content_item.get("name", "")
                            t_args = content_item.get("arguments", {})
                            if is_candidate_skill_read(t_name, t_args, command_file, skill_dir, project_root_path):
                                triggered = True

        if process.returncode != 0:
            err_detail = api_error or (stderr.strip() if stderr else "") or f"Process exited with code {process.returncode}"
            return {
                "triggered": False,
                "error": err_detail,
                "error_type": "process",
            }

        if api_error:
            return {
                "triggered": False,
                "error": api_error,
                "error_type": "api",
            }

        if not saw_assistant:
            return {"triggered": False, "error": "Pi emitted no completed assistant message", "error_type": "protocol"}

        return {
            "triggered": triggered,
            "error": None,
            "error_type": None,
        }
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def run_eval(
    eval_set: list[dict],
    skill_name: str,
    description: str,
    num_workers: int,
    timeout: int,
    project_root: Path,
    runs_per_query: int = 1,
    trigger_threshold: float = 0.5,
    model: str | None = None,
) -> dict:
    """Run the full eval set and return results.

    Errors (process, timeout, API) fail evaluation queries rather than being
    counted as negative triggers, avoiding false positive passes on should_trigger=False.
    """
    results = []

    with ProcessPoolExecutor(max_workers=num_workers) as executor:
        future_to_info = {}
        for item in eval_set:
            for run_idx in range(runs_per_query):
                future = executor.submit(
                    run_single_query,
                    item["query"],
                    skill_name,
                    description,
                    timeout,
                    str(project_root),
                    model,
                )
                future_to_info[future] = (item, run_idx)

        query_runs: dict[str, list[dict]] = {}
        query_items: dict[str, dict] = {}
        for future in as_completed(future_to_info):
            item, _ = future_to_info[future]
            query = item["query"]
            query_items[query] = item
            if query not in query_runs:
                query_runs[query] = []
            try:
                res = future.result()
                if isinstance(res, dict):
                    query_runs[query].append(res)
                elif isinstance(res, bool):
                    query_runs[query].append({"triggered": res, "error": None, "error_type": None})
                else:
                    query_runs[query].append({
                        "triggered": False,
                        "error": f"Unexpected result format: {res}",
                        "error_type": "unknown",
                    })
            except Exception as e:
                query_runs[query].append({
                    "triggered": False,
                    "error": str(e),
                    "error_type": "exception",
                })

    has_any_errors = False
    for query, runs in query_runs.items():
        item = query_items[query]
        should_trigger = item["should_trigger"]

        errors = [r["error"] for r in runs if r.get("error")]
        query_has_error = len(errors) > 0
        if query_has_error:
            has_any_errors = True

        triggers = [1 if r.get("triggered") else 0 for r in runs]
        trigger_rate = sum(triggers) / len(triggers) if runs else 0.0

        if query_has_error:
            # Errors must fail the query; do not reward negatives on crash/timeout
            did_pass = False
        else:
            if should_trigger:
                did_pass = trigger_rate >= trigger_threshold
            else:
                did_pass = trigger_rate < trigger_threshold

        res_entry = {
            "query": query,
            "should_trigger": should_trigger,
            "trigger_rate": trigger_rate,
            "triggers": sum(triggers),
            "runs": len(runs),
            "pass": did_pass,
        }
        if query_has_error:
            res_entry["error"] = "; ".join(errors)
            res_entry["errors"] = errors
        results.append(res_entry)

    passed = sum(1 for r in results if r["pass"])
    total = len(results)
    return {
        "results": results,
        "summary": {
            "passed": passed,
            "failed": total - passed,
            "total": total,
            "pass_rate": passed / total if total > 0 else 0.0,
            "has_errors": has_any_errors,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Run trigger eval for a skill description")
    parser.add_argument("eval_set", type=Path, help="Path to eval set JSON file")
    parser.add_argument("--skill-path", type=Path, required=True, help="Path to skill directory")
    parser.add_argument("--description", default=None, help="Override description to test")
    parser.add_argument("--num-workers", type=int, default=1, help="Number of parallel workers (default: 1)")
    parser.add_argument("--timeout", type=int, default=60, help="Timeout per query in seconds (default: 60)")
    parser.add_argument("--runs-per-query", type=int, default=1, help="Number of runs per query (default: 1)")
    parser.add_argument("--trigger-threshold", type=float, default=0.5, help="Threshold fraction for triggering")
    parser.add_argument("--model", default=None, help="Model to use for Pi CLI (default: configured model)")
    parser.add_argument("--output", type=Path, default=None, help="Path to save output JSON")
    args = parser.parse_args()

    skill_name, desc_from_file, _ = parse_skill_md(args.skill_path)
    description = args.description or desc_from_file
    eval_set = json.loads(args.eval_set.read_text())
    project_root = find_project_root()

    results = run_eval(
        eval_set=eval_set,
        skill_name=skill_name,
        description=description,
        num_workers=args.num_workers,
        timeout=args.timeout,
        project_root=project_root,
        runs_per_query=args.runs_per_query,
        trigger_threshold=args.trigger_threshold,
        model=args.model,
    )

    output_json = json.dumps(results, indent=2)
    if args.output:
        args.output.write_text(output_json)
        print(f"Results saved to {args.output}")
    else:
        print(output_json)

    print(f"\nPassed: {results['summary']['passed']}/{results['summary']['total']} "
          f"({results['summary']['pass_rate']:.1%})", file=sys.stderr)

    if results["summary"]["passed"] < results["summary"]["total"] or results["summary"].get("has_errors"):
        sys.exit(1)


if __name__ == "__main__":
    main()
