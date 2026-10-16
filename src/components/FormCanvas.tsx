import { useForm } from '../state/useFormStore';
import { FieldRenderer } from './FieldRenderer';
import { InertButton } from './Inert';

export function FormCanvas() {
  const { state, dispatch } = useForm();
  return (
    <main className="canvas" onClick={() => dispatch({ type: 'select', name: null })}>
      {state.doc.schema.properties.map((n) => (
        <FieldRenderer key={n.name} node={n} topLevel />
      ))}
      <div className="canvas__footer">
        <InertButton className="btn" label="Save and close">
          Save and close
        </InertButton>
      </div>
    </main>
  );
}
