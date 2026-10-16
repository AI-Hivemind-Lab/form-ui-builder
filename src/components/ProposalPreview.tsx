import { findNode, getWidget } from '../model/schemaWalk';
import type { FormDoc } from '../model/types';
import type { Anchors } from '../model/pdfStore';
import { FormProvider } from '../state/useFormStore';
import { FieldRenderer } from './FieldRenderer';
import { NoProposals } from './proposalIndex';

/**
 * The widgets a proposal would build, drawn with the real renderer from the form as it would be after accepting: you see the actual
 * result, not a description of it. It is a picture: nothing in it can be clicked or typed into.
 */
export function ProposalPreview({ after, show, anchors }: { after: FormDoc; show: string[]; anchors: Anchors }) {
  // a new page is drawn by its contents (a page only shows while it is the open one)
  const nodes = show.flatMap((name) => {
    const n = findNode(after.schema.properties, name);
    return n && getWidget(after, n) === 'Page' ? (n.properties ?? []) : n ? [n] : [];
  });
  if (nodes.length === 0) return null;
  return (
    <div className="proposal__preview" aria-label="Preview of the result">
      <span className="proposal__preview-tag">Preview</span>
      <div className="proposal__preview-body" {...({ inert: '' } as Record<string, string>)}>
        <FormProvider initialDoc={after} anchors={anchors}>
          <NoProposals>
            {nodes.map((n) => <FieldRenderer key={n.name} node={n} asBelow />)}
          </NoProposals>
        </FormProvider>
      </div>
    </div>
  );
}
