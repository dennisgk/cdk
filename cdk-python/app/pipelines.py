from __future__ import annotations

import asyncio
import itertools
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Awaitable, Callable

from .config import AppConfig, PipelineConfig


def now_utc_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class PipelineJob:
    id: str
    pipeline_name: str
    label: str
    metadata: dict[str, Any]
    created_at: str
    coro_factory: Callable[[], Awaitable[Any] | Any]
    future: asyncio.Future[Any]


@dataclass
class RunningJob:
    id: str
    label: str
    metadata: dict[str, Any]
    started_at: str


@dataclass
class PipelineState:
    config: PipelineConfig
    queue: asyncio.Queue[PipelineJob] = field(default_factory=asyncio.Queue)
    workers: list[asyncio.Task[None]] = field(default_factory=list)
    running_jobs: dict[str, RunningJob] = field(default_factory=dict)
    completed_jobs: int = 0


class PipelineManager:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self._pipelines = {
            pipeline.name: PipelineState(config=pipeline)
            for pipeline in config.pipelines
        }
        self._counter = itertools.count(1)
        self._started = False

    async def startup(self) -> None:
        if self._started:
            return
        self._started = True
        for state in self._pipelines.values():
            for worker_index in range(state.config.max_concurrency):
                state.workers.append(
                    asyncio.create_task(
                        self._worker_loop(state, worker_index),
                        name=f"pipeline:{state.config.name}:{worker_index}",
                    )
                )

    async def shutdown(self) -> None:
        for state in self._pipelines.values():
            for worker in state.workers:
                worker.cancel()
        await asyncio.gather(
            *[worker for state in self._pipelines.values() for worker in state.workers],
            return_exceptions=True,
        )
        for state in self._pipelines.values():
            state.workers.clear()
        self._started = False

    async def submit(
        self,
        pipeline_name: str,
        label: str,
        coro_factory: Callable[[], Awaitable[Any] | Any],
        metadata: dict[str, Any] | None = None,
    ) -> Any:
        if pipeline_name not in self._pipelines:
            raise ValueError(f'Unknown pipeline "{pipeline_name}".')
        state = self._pipelines[pipeline_name]
        loop = asyncio.get_running_loop()
        future: asyncio.Future[Any] = loop.create_future()
        job = PipelineJob(
            id=f"{pipeline_name}-{next(self._counter)}",
            pipeline_name=pipeline_name,
            label=label,
            metadata=metadata or {},
            created_at=now_utc_iso(),
            coro_factory=coro_factory,
            future=future,
        )
        await state.queue.put(job)
        return await future

    async def submit_gpu_heavy(
        self,
        label: str,
        coro_factory: Callable[[], Awaitable[Any] | Any],
        metadata: dict[str, Any] | None = None,
    ) -> Any:
        return await self.submit("gpu_heavy", label, coro_factory, metadata)

    def telemetry(self) -> dict[str, Any]:
        return {
            "pipelines": [
                {
                    "name": state.config.name,
                    "category": state.config.category,
                    "description": state.config.description,
                    "max_concurrency": state.config.max_concurrency,
                    "queued_count": state.queue.qsize(),
                    "running_count": len(state.running_jobs),
                    "completed_jobs": state.completed_jobs,
                    "running_jobs": [
                        {
                            "id": job.id,
                            "label": job.label,
                            "metadata": job.metadata,
                            "started_at": job.started_at,
                        }
                        for job in state.running_jobs.values()
                    ],
                }
                for state in self._pipelines.values()
            ]
        }

    async def _worker_loop(self, state: PipelineState, worker_index: int) -> None:
        while True:
            job = await state.queue.get()
            state.running_jobs[job.id] = RunningJob(
                id=job.id,
                label=job.label,
                metadata=job.metadata,
                started_at=now_utc_iso(),
            )
            try:
                result = job.coro_factory()
                if asyncio.iscoroutine(result):
                    result = await result
                if not job.future.done():
                    job.future.set_result(result)
                state.completed_jobs += 1
            except Exception as exc:
                if not job.future.done():
                    job.future.set_exception(exc)
            finally:
                state.running_jobs.pop(job.id, None)
                state.queue.task_done()


class RoutineTaskPipelineFacade:
    def __init__(self, manager: PipelineManager) -> None:
        self._manager = manager

    async def submit(
        self,
        pipeline_name: str,
        label: str,
        coro_factory: Callable[[], Awaitable[Any] | Any],
        metadata: dict[str, Any] | None = None,
    ) -> Any:
        return await self._manager.submit(pipeline_name, label, coro_factory, metadata)

    def telemetry(self) -> dict[str, Any]:
        return self._manager.telemetry()
