import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { FormDoc } from '../model/types';
import type { ProposalSet } from '../generator/ai/proposals';
import type { Anchors } from '../model/pdfStore';
import { loadIgnored } from '../model/persist';
import { formReducer, initialState, type Action, type FormState } from './formReducer';

interface Store {
  state: FormState;
  dispatch: Dispatch<Action>;
}

const Ctx = createContext<Store | null>(null);

export function FormProvider({ initialDoc, initialProposals, anchors = {}, children }: { initialDoc: FormDoc; initialProposals?: ProposalSet | null; anchors?: Anchors; children: ReactNode }) {
  const [state, dispatch] = useReducer(formReducer, initialDoc, (doc) => ({
    ...initialState(doc),
    ignoredWarnings: loadIgnored(),
    proposals: initialProposals?.decisions ?? [],
    proposalNotes: initialProposals?.notes ?? [],
    aiTexts: initialProposals?.texts ?? [],
    anchors,
  }));
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>;
}

export function useForm(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('useForm must be used inside <FormProvider>');
  return store;
}
