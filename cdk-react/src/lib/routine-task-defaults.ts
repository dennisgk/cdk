export const defaultRoutineTaskPythonCode = `from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
import json

TASK_TYPE = "NEXT_DATETIME_RUNNER"


async def next_datetime(data_dir: Path, data_obj: dict, active_relatives: dict):
    return datetime.now(UTC) + timedelta(minutes=15)


def ensure_state(data_dir: Path, data_obj: dict):
    data_dir.mkdir(parents=True, exist_ok=True)
    state_path = data_dir / "state.json"
    if not state_path.exists():
        state_path.write_text(json.dumps({"runs": 0}), encoding="utf-8")
    data_obj.setdefault("runs", 0)


async def pause(data_dir: Path, data_obj: dict):
    ensure_state(data_dir, data_obj)
    pass


async def resume(data_dir: Path, data_obj: dict):
    ensure_state(data_dir, data_obj)
    pass


async def unload(data_dir: Path, data_obj: dict):
    pass


async def runner(data_dir: Path, data_obj: dict):
    state_path = data_dir / "state.json"
    state = {"runs": 0}
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
    state["runs"] += 1
    state_path.write_text(json.dumps(state), encoding="utf-8")
    data_obj["runs"] = state["runs"]


async def remote_handler(
    data_dir: Path,
    data_obj: dict,
    set_next_datetime,
    request,
    subject: str,
    body,
    query: dict,
    method: str,
    path_params: dict,
    remote_path: str,
):
    state_path = data_dir / "state.json"
    state = {"runs": 0}
    if state_path.exists():
        state = json.loads(state_path.read_text(encoding="utf-8"))
    if remote_path == "refresh":
        await set_next_datetime(datetime.now(UTC))
        return {
            "ok": True,
            "message": "Forced refresh requested.",
        }
    return {
        "subject": subject,
        "method": method,
        "state": state,
        "data_obj": data_obj,
        "query": query,
        "remote_path": remote_path,
        "has_set_next_datetime": True,
        "llm_host": CONFIG["llm"]["host"],
    }
`

export const defaultRoutineTaskJsxCode = `export async function loader({ task, callRemote }) {
  const payload = await callRemote()
  return {
    taskName: task.name,
    runCount: payload.state.runs,
    subject: payload.subject,
  }
}

export function Component({ data }) {
  return (
    <div style={{ padding: "8px" }}>
      <div>Task: {data.taskName}</div>
      <div>Runs: {data.runCount}</div>
      <div>Subject: {data.subject}</div>
    </div>
  )
}
`
