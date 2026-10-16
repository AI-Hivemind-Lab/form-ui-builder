import { useEffect, useMemo, useState, type Dispatch, type DragEvent } from 'react';
import { findParentName } from '../model/addField';
import { pagesOutOfOrder, type OrderIssue } from '../generator/pageOrder';
import { findNode, getWidget, isInvisible } from '../model/schemaWalk';
import { dropTarget, nodeLabel, type DropZone } from '../model/tree';
import { allWarnings, visibleWarnings } from '../model/warnings';
import type { SchemaNode } from '../model/types';
import { widgetKind } from '../model/widgetCatalog';
import type { FormDoc } from '../model/types';
import type { Action } from '../state/formReducer';
import { useForm } from '../state/useFormStore';
import { CaretIcon, PlusIcon, TrashIcon, UndoIcon, WidgetIcon } from './icons';
import { ProposalsPanel } from './ProposalsPanel';
import { reveal } from './reveal';
import { WidgetPicker } from './WidgetPicker';
import { WidgetSearch } from './WidgetSearch';

const HEAD = '';

/** Every page, group and repeatable that has something inside: a form starts with all of them closed. */
function foldedGroups(doc: FormDoc): Set<string> {
  const names = new Set<string>();
  const visit = (nodes: SchemaNode[]): void =>
    nodes.forEach((n) => {
      const kids = n.properties ?? [];
      if (kids.length > 0 && widgetKind(getWidget(doc, n)) === 'container') names.add(n.name);
      visit(kids);
    });
  visit(doc.schema.properties);
  return names;
}

function TreeNodes({
  nodes, depth, collapsed, toggle, picker, setPicker, drag, order,
}: {
  nodes: SchemaNode[];
  /** Pages that sit out of the sub-doc's order, by name. */
  order: Map<string, OrderIssue>;
  depth: number;
  collapsed: Set<string>;
  toggle: (name: string) => void;
  picker: string | null;
  setPicker: (name: string | null) => void;
  drag: { from: string | null; setFrom: (n: string | null) => void; over: { name: string; zone: DropZone } | null; setOver: (o: { name: string; zone: DropZone } | null) => void };
}) {
  const { state, dispatch } = useForm();
  const { doc } = state;

  const selectRow = (node: SchemaNode) => reveal(doc, node.name, dispatch);

  const zoneOf = (e: DragEvent<HTMLElement>, container: boolean): DropZone => {
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    if (f < 0.3) return 'before';
    if (f > 0.7) return 'after';
    return container ? 'into' : f < 0.5 ? 'before' : 'after';
  };

  return (
    <ul className="tree">
      {nodes.map((node) => {
        const widget = getWidget(doc, node);
        const container = widgetKind(widget) === 'container';
        const kids = node.properties ?? [];
        const open = !collapsed.has(node.name);
        const selected = state.selection === node.name || (widget === 'Page' && state.activePage === node.name && state.selection === null);
        const over = drag.over?.name === node.name ? drag.over.zone : null;
        return (
          <li key={node.name}>
            <div
              className={[
                'tree__row', selected && 'tree__row--selected', isInvisible(doc, node.name) && 'tree__row--invisible', state.botChanges.some((c) => c.alias === node.name && c.kind !== 'removed') && 'tree__row--botchanged',
                drag.from === node.name && 'tree__row--dragging', over && `tree__row--drop-${over}`,
              ].filter(Boolean).join(' ')}
              style={{ paddingLeft: depth * 18 + 4 }}
              draggable
              data-tree={node.name}
              onClick={() => selectRow(node)}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', node.name);
                e.dataTransfer.effectAllowed = 'move';
                drag.setFrom(node.name);
              }}
              onDragEnd={() => { drag.setFrom(null); drag.setOver(null); }}
              onDragOver={(e) => {
                if (!drag.from) return;
                const zone = zoneOf(e, container);
                if (dropTarget(doc, drag.from, node.name, zone)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (drag.over?.name !== node.name || drag.over.zone !== zone) drag.setOver({ name: node.name, zone });
                } else if (drag.over) drag.setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!drag.from) return;
                const t = dropTarget(doc, drag.from, node.name, zoneOf(e, container));
                if (t) dispatch({ type: 'moveNode', name: drag.from, parent: t.parent, index: t.index });
                drag.setFrom(null);
                drag.setOver(null);
              }}
            >
              {container && kids.length > 0 ? (
                <button type="button" className="tree__caret" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={open} onClick={(e) => { e.stopPropagation(); toggle(node.name); }}>
                  <CaretIcon open={open} />
                </button>
              ) : <span className="tree__caret" />}
              <span className="tree__icon"><WidgetIcon id={widget} /></span>
              <span className="tree__label" title={nodeLabel(doc, node)}>{nodeLabel(doc, node)}</span>
              {visibleWarnings(doc, node, state.ignoredWarnings).length > 0 && (
                <span className="tree__warn" title={visibleWarnings(doc, node, state.ignoredWarnings).join('\n')} aria-label={visibleWarnings(doc, node, state.ignoredWarnings).join(', ')}>⚠</span>
              )}
              {order.has(node.name) && (
                <span className="tree__warn tree__order" title={`Starts on PDF page ${order.get(node.name)?.pdfPage}, but sits out of the PDF's order. In the PDF it comes ${order.get(node.name)?.after ? `after "${order.get(node.name)?.after?.title}" (PDF page ${order.get(node.name)?.after?.pdfPage})` : 'before the first page of the form'}.`} aria-label="Out of the PDF's page order">⇅</span>
              )}
              <span className="tree__actions">
                <button type="button" className="tree__btn" data-picker-anchor aria-label={`Add below ${node.title}`} aria-expanded={picker === node.name}
                  onClick={(e) => { e.stopPropagation(); setPicker(picker === node.name ? null : node.name); }}>
                  <PlusIcon />
                </button>
                <button type="button" className="tree__btn" aria-label={`Delete ${node.title}`} onClick={(e) => { e.stopPropagation(); dispatch({ type: 'removeNode', name: node.name }); }}>
                  <TrashIcon />
                </button>
              </span>
              {picker === node.name && (
                // Clicks inside the picker must not reach the row (a row click selects, which would cancel the add).
                <div onClick={(e) => e.stopPropagation()} onDragStart={(e) => e.preventDefault()} draggable={false}>
                  <WidgetPicker
                    onClose={() => setPicker(null)}
                    onPick={(w) => { dispatch({ type: 'startAdd', widget: w, anchor: node.name }); setPicker(null); }}
                  />
                </div>
              )}
            </div>
            {container && kids.length > 0 && open ? (
              <TreeNodes nodes={kids} depth={depth + 1} collapsed={collapsed} toggle={toggle} picker={picker} setPicker={setPicker} drag={drag} order={order} />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function TocPanel() {
  const { state, dispatch } = useForm();
  const warnings = useMemo(() => allWarnings(state.doc, state.ignoredWarnings), [state.doc, state.ignoredWarnings]);
  const order = useMemo(() => new Map(pagesOutOfOrder(state.doc, state.anchors).map((o) => [o.name, o])), [state.doc, state.anchors]);
  const [picker, setPicker] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => foldedGroups(state.doc));
  // A form that was just loaded starts with every page and group closed; open them one by one.
  useEffect(() => {
    if (state.loadId > 0) setCollapsed(foldedGroups(state.doc));
  }, [state.loadId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [from, setFrom] = useState<string | null>(null);
  const [over, setOver] = useState<{ name: string; zone: DropZone } | null>(null);
  // Selecting something (on the canvas, in the PDF, after adding) shows it in the tree: open its folders, scroll to it.
  useEffect(() => {
    const sel = state.selection;
    if (!sel) return;
    const ancestors: string[] = [];
    for (let cur = findParentName(state.doc, sel); cur; cur = findParentName(state.doc, cur)) ancestors.push(cur);
    setCollapsed((c) => (ancestors.some((a) => c.has(a)) ? new Set([...c].filter((x) => !ancestors.includes(x))) : c));
    const t = setTimeout(() => document.querySelector(`[data-tree="${CSS.escape(sel)}"]`)?.scrollIntoView({ block: 'nearest' }), 30);
    return () => clearTimeout(t);
  }, [state.selection]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (name: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (!n.delete(name)) n.add(name);
      return n;
    });
  return (
    <nav className="toc">
      <div className="toc__head">
        <h2 className="toc__title">Table of Contents</h2>
        <div className="toc__tools">
          {warnings.length > 0 && (
            <button type="button" className="toc__warncount" title={warnings.map((w) => `${w.title || w.name}: ${w.messages.join(', ')}`).join('\n')} onClick={() => {
              const at = warnings.findIndex((w) => w.name === state.selection);
              reveal(state.doc, warnings[(at + 1) % warnings.length].name, dispatch);
            }}>
              ⚠ {warnings.length}
            </button>
          )}
          <button type="button" className="toc__add" aria-label="Undo last action" title="Undo last action (Cmd/Ctrl+Z)" disabled={state.past.length === 0} onClick={() => dispatch({ type: 'undo' })}>
            <UndoIcon />
          </button>
          <button type="button" className="toc__add" data-picker-anchor aria-label="Add widget" aria-expanded={picker === HEAD} onClick={() => setPicker(picker === HEAD ? null : HEAD)}>
            <PlusIcon />
          </button>
        </div>
        {picker === HEAD && (
          <WidgetPicker onClose={() => setPicker(null)} onPick={(widget) => { dispatch({ type: 'startAdd', widget }); setPicker(null); }} />
        )}
      </div>
      <WidgetSearch doc={state.doc} onPick={(name) => reveal(state.doc, name, dispatch)} />
      <ProposalsPanel />
      {state.doc.schema.properties.length === 0 ? (
        <div className="tree__empty">The form is empty. Use + to add a widget.</div>
      ) : (
        <TreeNodes
          nodes={state.doc.schema.properties}
          depth={0}
          collapsed={collapsed}
          toggle={toggle}
          picker={picker}
          setPicker={setPicker}
          drag={{ from, setFrom, over, setOver }}
          order={order}
        />
      )}
    </nav>
  );
}
