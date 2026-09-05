export interface GenerationJob {
  id: string;
  tileKey: string;
  layer: 'overall' | 'object';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string;
}
export interface QueueSnapshot {
  jobs: GenerationJob[];
  paused: boolean;
  reason: string;
  active: number;
}

/** Bounded scheduler. Cancellation aborts active fetches and prevents any later commit. */
export class GenerationQueue {
  private jobs: GenerationJob[] = [];
  private controllers = new Map<string, AbortController>();
  private paused = false;
  private reason = '';
  private serial = 0;
  private pumping = false;
  constructor(
    private options: {
      concurrency: () => number;
      canStart: (job: GenerationJob, running: number) => string | null;
      run: (job: GenerationJob, signal: AbortSignal) => Promise<void>;
      onComplete?: (job: GenerationJob) => void;
      onChange: (snapshot: QueueSnapshot) => void;
    },
  ) {}
  configure(options: Partial<GenerationQueue['options']>) {
    this.options = { ...this.options, ...options };
  }
  snapshot(): QueueSnapshot {
    return {
      jobs: this.jobs.map((job) => ({ ...job })),
      paused: this.paused,
      reason: this.reason,
      active: this.controllers.size,
    };
  }
  private emit() {
    this.options.onChange(this.snapshot());
  }
  add(targets: Array<Pick<GenerationJob, 'tileKey' | 'layer'>>) {
    for (const target of targets) {
      if (
        this.jobs.some(
          (job) =>
            job.tileKey === target.tileKey &&
            job.layer === target.layer &&
            (job.status === 'pending' || job.status === 'running'),
        )
      )
        continue;
      this.jobs.push({
        ...target,
        id: `generation_${++this.serial}`,
        status: 'pending',
      });
    }
    this.emit();
    this.pump();
  }
  pause(reason = '已暂停，进行中的任务会完成。') {
    this.paused = true;
    this.reason = reason;
    this.emit();
  }
  resume() {
    this.paused = false;
    this.reason = '';
    this.emit();
    this.pump();
  }
  cancel() {
    this.paused = false;
    this.reason = '已取消待处理和进行中的任务。';
    for (const job of this.jobs)
      if (job.status === 'pending' || job.status === 'running')
        job.status = 'cancelled';
    for (const controller of this.controllers.values()) controller.abort();
    this.emit();
  }
  retry() {
    for (const job of this.jobs)
      if (job.status === 'failed') {
        job.status = 'pending';
        job.error = undefined;
      }
    this.resume();
  }
  clear() {
    if (this.controllers.size) return;
    this.jobs = [];
    this.reason = '';
    this.emit();
  }
  private pump() {
    if (this.pumping || this.paused) return;
    this.pumping = true;
    try {
      while (
        !this.paused &&
        this.controllers.size <
          Math.max(1, Math.min(4, this.options.concurrency()))
      ) {
        const job = this.jobs.find((item) => item.status === 'pending');
        if (!job) break;
        const reason = this.options.canStart(job, this.controllers.size);
        if (reason) {
          this.pause(reason);
          break;
        }
        const controller = new AbortController();
        this.controllers.set(job.id, controller);
        job.status = 'running';
        this.emit();
        void Promise.resolve()
          .then(() => this.options.run(job, controller.signal))
          .then(() => {
            if (controller.signal.aborted) return;
            job.status = 'completed';
            this.options.onComplete?.(job);
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) {
              job.status = 'cancelled';
              return;
            }
            job.status = 'failed';
            job.error = error instanceof Error ? error.message : String(error);
          })
          .finally(() => {
            this.controllers.delete(job.id);
            this.emit();
            this.pump();
          });
      }
    } finally {
      this.pumping = false;
    }
  }
}
