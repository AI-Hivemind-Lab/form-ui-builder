import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { anchorsOf } from '../generator/ai/proposals';
import type { Decision } from '../generator/ai/types';
import { useForm } from '../state/useFormStore';

const Ctx = createContext<Map<string, Decision[]>>(new Map());

/** The proposals of each widget, worked out once per change (every widget on the canvas asks for its own). */
export function ProposalIndexProvider({ children }: { children: ReactNode }) {
  const { state } = useForm();
  const index = useMemo(() => {
    const map = new Map<string, Decision[]>();
    state.proposals.forEach((d) => anchorsOf(d, state.doc).forEach((name) => map.set(name, [...(map.get(name) ?? []), d])));
    return map;
  }, [state.proposals, state.doc]);
  return <Ctx.Provider value={index}>{children}</Ctx.Provider>;
}

export const useProposalsOn = (name: string): Decision[] => useContext(Ctx).get(name) ?? [];

/** Inside a preview the widgets must not show proposals of their own. */
export function NoProposals({ children }: { children: ReactNode }) {
  return <Ctx.Provider value={NONE}>{children}</Ctx.Provider>;
}
const NONE = new Map<string, Decision[]>();
