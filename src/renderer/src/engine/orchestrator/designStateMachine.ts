import {
  HVACDesignPhase,
  HVACDesignState,
  EngineeringWarning,
  EngineeringError
} from './orchestratorTypes';

export type StateChangeListener = (state: HVACDesignState) => void;

export class DesignStateMachine {
  private state: HVACDesignState;
  private listeners: Set<StateChangeListener> = new Set();

  constructor() {
    this.state = {
      currentPhase: HVACDesignPhase.INPUT_ANALYSIS,
      progressPercent: 0,
      status: 'IDLE',
      currentIteration: 0,
      warnings: [],
      errors: []
    };
  }

  public getState(): HVACDesignState {
    return { ...this.state, warnings: [...this.state.warnings], errors: [...this.state.errors] };
  }

  public subscribe(listener: StateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const copy = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(copy);
      } catch (err) {
        console.error('State change listener error:', err);
      }
    }
  }

  public start(): void {
    this.state.status = 'RUNNING';
    this.state.currentPhase = HVACDesignPhase.INPUT_ANALYSIS;
    this.state.progressPercent = 5;
    this.state.currentIteration = 0;
    this.state.warnings = [];
    this.state.errors = [];
    this.notify();
  }

  public transitionTo(phase: HVACDesignPhase, progressPercent?: number): void {
    this.state.currentPhase = phase;
    if (progressPercent !== undefined) {
      this.state.progressPercent = progressPercent;
    }
    this.notify();
  }

  public startOptimization(iteration: number): void {
    this.state.status = 'OPTIMIZING';
    this.state.currentIteration = iteration;
    this.notify();
  }

  public recordWarning(warning: EngineeringWarning): void {
    this.state.warnings.push(warning);
    this.notify();
  }

  public recordError(error: EngineeringError): void {
    this.state.errors.push(error);
    if (error.fatal) {
      this.state.status = 'FAILED';
    }
    this.notify();
  }

  public complete(): void {
    this.state.status = 'COMPLETE';
    this.state.currentPhase = HVACDesignPhase.COMPLETE;
    this.state.progressPercent = 100;
    this.notify();
  }

  public fail(errorMessage?: string): void {
    this.state.status = 'FAILED';
    this.state.currentPhase = HVACDesignPhase.FAILED;
    if (errorMessage) {
      this.state.errors.push({
        code: 'FATAL_ERROR',
        phase: this.state.currentPhase,
        message: errorMessage,
        fatal: true
      });
    }
    this.notify();
  }
}
