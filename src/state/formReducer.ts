import { diffDocs, revertChange, type Change } from '../chat/changes';
import { collectDefaults } from '../model/defaults';
import { applyDecisions } from '../generator/ai/apply';
import type { ProposalSet } from '../generator/ai/proposals';
import type { Decision } from '../generator/ai/types';
import type { Anchors } from '../model/pdfStore';
import { insertNode, type InsertLocation } from '../model/addField';
import { addRow, maxItemsOf, removeRow, setRowValue } from '../model/rows';
import { findNode, getAllPages, getWidget, isInvisible } from '../model/schemaWalk';
import { moveNode, removeNode, subtreeNames } from '../model/tree';
import { warningKey } from '../model/warnings';
import type { FormDoc, SchemaNode, UiEntry, UiSchema, Values } from '../model/types';

export interface FormState {
  doc: FormDoc;
  values: Values;
  selection: string | null;
  showInvisible: boolean;
  /** Draw each widget's name (alias) on the canvas. */
  showAlias: boolean;
  /** The source PDF is shown beside the form. */
  pdfOpen: boolean;
  /** Warnings the user chose to ignore, as warningKey(name, message). */
  ignoredWarnings: string[];
  activePage: string | null;
  /** Set while the Add field panel is open; the widget id picked in the picker. */
  adding: { widget: string; /** The element whose "+" was used: the new field goes right below it. */ anchor?: string } | null;
  notice: string | null;
  /** Earlier docs (newest last) for Undo of add / remove / move. Docs are immutable, so snapshots are cheap. */
  past: FormDoc[];
  /** The last property/text edit, so a burst of typing on one field is one undo step. */
  lastEdit: { key: string; at: number } | null;
  /** What the AI proposed and has not been accepted or dismissed yet; each shows on its widget. */
  proposals: Decision[];
  /** What the AI skipped or could not do. */
  proposalNotes: string[];
  /** What applying a proposal needs: the annotation's texts and where the PDF fields sit. */
  aiTexts: string[];
  anchors: Anchors;
  /** Counts the forms loaded into the editor, so the table of contents can start a new form collapsed. */
  loadId: number;
  /** What the assistant changed that the person has not yet accepted or put back. */
  botChanges: Change[];
  /** The form as it was when the assistant's current turn began (null between turns). */
  botBase: FormDoc | null;
}

const HISTORY_LIMIT = 100;

export type Action =
  | { type: 'setValue'; name: string; value: unknown }
  | { type: 'setRowValue'; rep: string; index: number; name: string; value: unknown }
  | { type: 'addRow'; rep: string }
  | { type: 'removeRow'; rep: string; index: number }
  | { type: 'editDoc'; schema?: FormDoc['schema']; uiSchema?: UiSchema; /** Edits with the same key close in time share one undo step. */ key?: string; at?: number }
  | { type: 'select'; name: string | null }
  | { type: 'startAdd'; widget: string; anchor?: string }
  | { type: 'removeNode'; name: string }
  | { type: 'moveNode'; name: string; parent: string | null; index: number }
  | { type: 'undo' }
  | { type: 'cancelAdd' }
  | { type: 'addNode'; node: SchemaNode; ui: UiEntry; loc: InsertLocation }
  | { type: 'toggleInvisible' }
  | { type: 'toggleAlias' }
  | { type: 'togglePdf' }
  | { type: 'ignoreWarnings'; name: string; messages: string[] }
  | { type: 'restoreWarnings' }
  | { type: 'setPage'; name: string }
  | { type: 'loadDoc'; doc: FormDoc }
  /** The assistant's turn begins: one undo step covers all it changes. */
  | { type: 'botStart' }
  | { type: 'botSetDoc'; doc: FormDoc }
  | { type: 'botEnd' }
  | { type: 'botAccept'; id: string | 'all' }
  | { type: 'botRevert'; id: string | 'all' }
  | { type: 'setProposals'; set: ProposalSet | null; anchors: Anchors }
  | { type: 'acceptProposals'; ids: string[] }
  | { type: 'dismissProposals'; ids: string[] }
  | { type: 'notify'; message: string }
  | { type: 'dismissNotice' };

/** The first page that is not hidden (a hidden page only holds the source PDF); else the first page. */
function firstOpenPage(doc: FormDoc): string | null {
  const pages = getAllPages(doc, true);
  return (pages.find((p) => !isInvisible(doc, p.name)) ?? pages[0])?.name ?? null;
}

export function initialState(doc: FormDoc): FormState {
  return {
    doc,
    values: collectDefaults(doc),
    selection: null,
    showInvisible: true,
    showAlias: false,
    pdfOpen: false,
    ignoredWarnings: [],
    activePage: firstOpenPage(doc),
    adding: null,
    notice: null,
    past: [],
    lastEdit: null,
    proposals: [],
    proposalNotes: [],
    aiTexts: [],
    anchors: {},
    loadId: 0,
    botChanges: [],
    botBase: null,
  };
}

const pushPast = (state: FormState): FormDoc[] => [...state.past, state.doc].slice(-HISTORY_LIMIT);

/**
 * The proposals an undo step puts back: accepting (or dismissing) a proposal is one step, and undoing it returns the proposal to the
 * list, on its widget. Keyed by the document that step went back to, so the history itself stays a plain list of documents.
 */
const restores = new WeakMap<FormDoc, { decision: Decision; index: number }[]>();

/** Keep selection and active page valid after the doc changed under them. */
function settle(state: FormState): FormState {
  const selection = state.selection && findNode(state.doc.schema.properties, state.selection) ? state.selection : null;
  const pages = getAllPages(state.doc, state.showInvisible);
  const activePage = pages.some((p) => p.name === state.activePage) ? state.activePage : (pages[0]?.name ?? null);
  return { ...state, selection, activePage };
}

export function formReducer(state: FormState, action: Action): FormState {
  switch (action.type) {
    case 'setValue':
      return { ...state, values: { ...state.values, [action.name]: action.value } };
    case 'setRowValue': {
      const values = setRowValue(state.values, action.rep, action.index, action.name, action.value);
      return values === state.values ? state : { ...state, values };
    }
    case 'addRow': {
      const values = addRow(state.values, action.rep, maxItemsOf(state.doc, action.rep));
      return values === state.values ? state : { ...state, values };
    }
    case 'removeRow': {
      const values = removeRow(state.values, action.rep, action.index);
      return values === state.values ? state : { ...state, values };
    }
    case 'editDoc': {
      // One undo step per burst of edits to the same field (typing in a box), a new step otherwise.
      const at = action.at ?? Date.now();
      const key = action.key ?? state.selection ?? '';
      const burst = state.lastEdit !== null && state.lastEdit.key === key && at - state.lastEdit.at < 1500;
      return {
        ...state,
        past: burst ? state.past : pushPast(state),
        lastEdit: { key, at },
        doc: {
          ...state.doc,
          schema: action.schema ?? state.doc.schema,
          uiSchema: action.uiSchema ?? state.doc.uiSchema,
        },
      };
    }
    case 'select':
      return { ...state, selection: action.name, adding: null };
    case 'startAdd':
      return { ...state, adding: { widget: action.widget, anchor: action.anchor } };
    case 'cancelAdd':
      return { ...state, adding: null };
    case 'addNode': {
      let doc: FormDoc;
      try {
        doc = insertNode(state.doc, action.node, action.ui, action.loc);
      } catch (err) {
        // Keep the form and the open Add panel; tell the user why the field was not added.
        return { ...state, notice: err instanceof Error ? err.message : 'Could not add the field' };
      }
      const widget = getWidget(doc, action.node);
      return {
        ...state,
        doc,
        past: pushPast(state),
        adding: null,
        selection: widget === 'Page' ? null : action.node.name,
        activePage: widget === 'Page' ? action.node.name : state.activePage,
      };
    }
    case 'removeNode': {
      const node = findNode(state.doc.schema.properties, action.name);
      if (!node) return state;
      const count = subtreeNames(node).length - 1;
      return {
        ...settle({ ...state, doc: removeNode(state.doc, action.name), past: pushPast(state), adding: null }),
        notice: `Deleted “${node.title}”${count > 0 ? ` and ${count} field${count === 1 ? '' : 's'} inside it` : ''}`,
      };
    }
    case 'moveNode': {
      try {
        const doc = moveNode(state.doc, action.name, action.parent, action.index);
        return doc === state.doc ? state : settle({ ...state, doc, past: pushPast(state) });
      } catch (err) {
        return { ...state, notice: err instanceof Error ? err.message : 'Could not move the field' };
      }
    }
    case 'undo': {
      const doc = state.past[state.past.length - 1];
      if (!doc) return state;
      const back = restores.get(doc) ?? [];
      const proposals = [...state.proposals];
      [...back].sort((a, b) => a.index - b.index).forEach((r) => {
        if (!proposals.some((p) => p.id === r.decision.id)) proposals.splice(Math.min(r.index, proposals.length), 0, r.decision);
      });
      return {
        ...settle({ ...state, doc, past: state.past.slice(0, -1), adding: null, lastEdit: null }),
        proposals,
        botChanges: [], // the person went back in time: what was waiting for review no longer matches the form
        notice: back.length > 0 ? `Undone: ${back.length === 1 ? 'the AI proposal is back' : `${back.length} AI proposals are back`}` : 'Undone',
      };
    }
    case 'toggleInvisible': {
      const showInvisible = !state.showInvisible;
      const pages = getAllPages(state.doc, showInvisible);
      const stillValid = pages.some((p) => p.name === state.activePage);
      return {
        ...state,
        showInvisible,
        activePage: stillValid ? state.activePage : (pages[0]?.name ?? null),
      };
    }
    case 'ignoreWarnings':
      return { ...state, ignoredWarnings: [...new Set([...state.ignoredWarnings, ...action.messages.map((m) => warningKey(action.name, m))])] };
    case 'restoreWarnings':
      return state.ignoredWarnings.length === 0 ? state : { ...state, ignoredWarnings: [] };
    case 'togglePdf':
      return { ...state, pdfOpen: !state.pdfOpen };
    case 'toggleAlias':
      return { ...state, showAlias: !state.showAlias };
    case 'setPage':
      return { ...state, activePage: action.name };
    case 'botStart':
      return state.botBase ? state : { ...state, botBase: state.doc, past: pushPast(state), lastEdit: null, adding: null };
    case 'botSetDoc':
      return settle({ ...state, doc: action.doc });
    case 'botEnd': {
      const base = state.botBase;
      if (!base) return state;
      const changes = diffDocs(base, state.doc);
      if (changes.length === 0) return { ...state, botBase: null, past: state.past[state.past.length - 1] === base ? state.past.slice(0, -1) : state.past };
      const fresh = new Set(changes.map((c) => c.id));
      return { ...state, botBase: null, botChanges: [...changes, ...state.botChanges.filter((c) => !fresh.has(c.id))] };
    }
    case 'botAccept':
      return { ...state, botChanges: action.id === 'all' ? [] : state.botChanges.filter((c) => c.id !== action.id) };
    case 'botRevert': {
      const chosen = action.id === 'all' ? state.botChanges : state.botChanges.filter((c) => c.id === action.id);
      if (chosen.length === 0) return state;
      // the newest first, so each change is put back onto the form it was made on
      const doc = [...chosen].reverse().reduce((d, c) => revertChange(d, c), state.doc);
      const gone = new Set(chosen.map((c) => c.id));
      return { ...settle({ ...state, doc, past: pushPast(state), lastEdit: null }), botChanges: state.botChanges.filter((c) => !gone.has(c.id)), notice: chosen.length === 1 ? 'Put back' : `Put back ${chosen.length} changes` };
    }
    case 'loadDoc':
      return { ...initialState(action.doc), showInvisible: state.showInvisible, showAlias: state.showAlias, pdfOpen: state.pdfOpen, anchors: state.anchors, loadId: state.loadId + 1 };
    case 'setProposals':
      return { ...state, proposals: action.set?.decisions ?? [], proposalNotes: action.set?.notes ?? [], aiTexts: action.set?.texts ?? [], anchors: action.anchors };
    case 'acceptProposals': {
      const chosen = state.proposals.filter((d) => action.ids.includes(d.id));
      if (chosen.length === 0) return state;
      const applied = applyDecisions(state.doc, state.anchors, state.aiTexts, chosen);
      restores.set(state.doc, chosen.map((d) => ({ decision: d, index: state.proposals.indexOf(d) })));
      return {
        ...settle({ ...state, doc: applied.doc, past: pushPast(state), adding: null, lastEdit: null }),
        proposals: state.proposals.filter((d) => !action.ids.includes(d.id)),
        notice: chosen.length === 1 ? `Applied: ${chosen[0].title}` : `Applied ${chosen.length} AI proposals`,
      };
    }
    case 'dismissProposals': {
      const gone = state.proposals.filter((d) => action.ids.includes(d.id));
      if (gone.length === 0) return state;
      // an undo step of its own (the form is unchanged, so a copy of it stands for the step)
      const snapshot = { ...state.doc };
      restores.set(snapshot, gone.map((d) => ({ decision: d, index: state.proposals.indexOf(d) })));
      return { ...state, past: [...state.past, snapshot].slice(-HISTORY_LIMIT), proposals: state.proposals.filter((d) => !action.ids.includes(d.id)) };
    }
    case 'notify':
      return { ...state, notice: action.message };
    case 'dismissNotice':
      return { ...state, notice: null };
  }
}
