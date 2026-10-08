import { describe, it, expect, vi } from 'vitest';
import { DesignStateMachine } from '../orchestrator/designStateMachine';
import { HVACDesignPhase } from '../orchestrator/orchestratorTypes';

describe('DesignStateMachine', () => {
  it('should initialize with IDLE state and 0 progress', () => {
    const sm = new DesignStateMachine();
    const state = sm.getState();
    expect(state.status).toBe('IDLE');
    expect(state.currentPhase).toBe(HVACDesignPhase.INPUT_ANALYSIS);
    expect(state.progressPercent).toBe(0);
    expect(state.warnings).toEqual([]);
    expect(state.errors).toEqual([]);
  });

  it('should transition through phases and notify subscribers', () => {
    const sm = new DesignStateMachine();
    const listener = vi.fn();
    sm.subscribe(listener);

    sm.start();
    expect(sm.getState().status).toBe('RUNNING');
    expect(listener).toHaveBeenCalled();

    sm.transitionTo(HVACDesignPhase.LOAD_ANALYSIS, 25);
    expect(sm.getState().currentPhase).toBe(HVACDesignPhase.LOAD_ANALYSIS);
    expect(sm.getState().progressPercent).toBe(25);

    sm.recordWarning({
      code: 'WARN_NC_HIGH',
      phase: HVACDesignPhase.ACOUSTIC_VALIDATION,
      message: 'Diffuser NC is near threshold'
    });
    expect(sm.getState().warnings.length).toBe(1);

    sm.recordError({
      code: 'ERR_GEOM',
      phase: HVACDesignPhase.ZONE_VALIDATION,
      message: 'Invalid polygon geometry',
      fatal: true
    });
    expect(sm.getState().status).toBe('FAILED');
    expect(sm.getState().errors.length).toBe(1);
  });

  it('should support optimization state transitions', () => {
    const sm = new DesignStateMachine();
    sm.start();
    sm.startOptimization(1);
    expect(sm.getState().status).toBe('OPTIMIZING');
    expect(sm.getState().currentIteration).toBe(1);

    sm.complete();
    expect(sm.getState().status).toBe('COMPLETE');
    expect(sm.getState().progressPercent).toBe(100);
  });
});
