import type { MouseEvent, ReactNode } from 'react';
import { getOptions } from '../model/editOps';
import { getRows } from '../model/rows';
import { findNode, getLabelHtml, getWidget, isInvisible, isSelectable, uiOf } from '../model/schemaWalk';
import { belowMap, fieldsBelowOf } from '../model/fieldsBelow';
import type { Option, SchemaNode } from '../model/types';
import { useForm } from '../state/useFormStore';
import { resolveWidget } from '../widgets/registry';
import type { RowScope } from '../widgets/shared';
import { visibleWarnings } from '../model/warnings';
import { EditableHtml } from './EditableHtml';
import { ProposalCard } from './ProposalCard';
import { useProposalsOn } from './proposalIndex';

const px = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const width = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' && v !== 'Auto' ? v : undefined);

export function FieldRenderer({
  node,
  row,
  topLevel = false,
  asBelow = false,
}: {
  node: SchemaNode;
  row?: RowScope;
  topLevel?: boolean;
  /** Rendered under its parent option; otherwise a field tagged below an option is hidden here. */
  asBelow?: boolean;
}) {
  const { state, dispatch } = useForm();
  const proposals = useProposalsOn(node.name); // (a hook: it runs before any early return below)
  const { doc, values, showInvisible, selection, activePage } = state;
  const changedByAssistant = state.botChanges.length > 0 && state.botChanges.some((c) => c.alias === node.name && c.kind !== 'removed');
  const declared = getWidget(doc, node);
  // A Repeatable nested inside a row has no rows of its own: render it like a Group.
  const widget = declared === 'Repeatable' && row ? 'Group' : declared;
  const ui = uiOf(doc, node.name);
  const invisible = isInvisible(doc, node.name);

  if (!asBelow && belowMap(doc).has(node.name)) return null;
  if (invisible && !showInvisible) return null;
  if (widget === 'Page' && activePage !== node.name) return null;

  const { Component, hasLabel } = resolveWidget(widget);
  const selectable = isSelectable(widget);
  const container = widget === 'Group' || widget === 'Page';
  const classes = [
    'field',
    selectable && 'field--selectable',
    (selectable || container) && selection === node.name && 'field--selected',
    // a group or a page is selected from the table of contents (or its heading): it shows the same frame as a single widget
    container && 'field--container',
    changedByAssistant && 'field--botchanged',
    invisible && 'field--invisible',
    widget === 'Repeatable' && 'field--repeatable',
  ]
    .filter(Boolean)
    .join(' ');
  const onClick = selectable
    ? (e: MouseEvent) => {
        e.stopPropagation();
        dispatch({ type: 'select', name: node.name });
      }
    : undefined;

  const cards = proposals.map((d) => <ProposalCard key={d.id} decision={d} />);
  const renderChildren = (scope?: RowScope): ReactNode => {
    const kids = node.properties?.map((child) => <FieldRenderer key={child.name} node={child} row={scope ?? row} />);
    if (widget !== 'Page' || !kids || cards.length === 0) return kids;
    // what is proposed for a page shows under the page's heading, not above it
    const head = (node.properties ?? []).findIndex((c) => getWidget(doc, c) === 'Header');
    return [...kids.slice(0, head + 1), ...cards, ...kids.slice(head + 1)];
  };

  const renderBelow = (option: Option): ReactNode => {
    const names = fieldsBelowOf(doc, node.name, option.value);
    if (names.length === 0) return null;
    return names.map((name) => {
      const child = findNode(doc.schema.properties, name);
      return child ? <FieldRenderer key={name} node={child} row={row} asBelow /> : null;
    });
  };

  const warns = visibleWarnings(doc, node, state.ignoredWarnings);
  const value = row ? getRows(values, row.rep)[row.index]?.[node.name] : values[node.name];
  const onChange = (v: unknown) =>
    row
      ? dispatch({ type: 'setRowValue', rep: row.rep, index: row.index, name: node.name, value: v })
      : dispatch({ type: 'setValue', name: node.name, value: v });
  const id = row ? `${row.rep}.${row.index}.${node.name}` : node.name;

  return (
    <div
      className={classes}
      style={{ paddingLeft: px(ui['ui:indentation']), marginBottom: px(ui['ui:marginBottom']), width: width(ui['ui:width']) }}
      onClick={onClick}
      data-field={node.name}
    >
      {changedByAssistant && <span className="field__badge field__badge--bot">✦ changed by the assistant</span>}
      {invisible && <span className="field__badge field__badge--invisible">invisible</span>}
      {warns.length > 0 && (
        <div className="field__warn" role="note">
          ⚠ {warns.join(' · ')}
          <button type="button" className="field__warn-ignore" onClick={(e) => { e.stopPropagation(); dispatch({ type: 'ignoreWarnings', name: node.name, messages: warns }); }}>
            Ignore
          </button>
        </div>
      )}
      {widget !== 'Page' && cards}
      {state.showAlias && widget !== 'Page' && !(widget === 'File' && topLevel) && <span className="field__alias">@ {node.name}</span>}
      {hasLabel && <EditableHtml name={node.name} className="field__label" html={getLabelHtml(doc, node)} />}
      {!hasLabel && widget === 'Group' && typeof ui['ui:formattedText'] === 'string' && (
        // A group is not clickable as a whole; its heading is the way to select it (and find it in the tree).
        <div onClick={(e) => { e.stopPropagation(); dispatch({ type: 'select', name: node.name }); }}>
          <EditableHtml name={node.name} className="field__label" html={getLabelHtml(doc, node)} />
        </div>
      )}
      <Component
        id={id}
        widget={widget}
        node={node}
        ui={ui}
        value={value}
        onChange={onChange}
        options={getOptions(ui, node)}
        topLevel={topLevel}
        renderChildren={renderChildren}
        renderBelow={renderBelow}
      >
        {widget === 'Repeatable' ? undefined : renderChildren()}
      </Component>
    </div>
  );
}
