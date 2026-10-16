import { useEffect } from 'react';
import { useForm } from '../state/useFormStore';

export function Toast() {
  const { state, dispatch } = useForm();
  useEffect(() => {
    if (!state.notice) return;
    const t = setTimeout(() => dispatch({ type: 'dismissNotice' }), 4000);
    return () => clearTimeout(t);
  }, [state.notice, dispatch]);
  if (!state.notice) return null;
  return (
    <div className="toast" role="status" onClick={() => dispatch({ type: 'dismissNotice' })}>
      {state.notice}
    </div>
  );
}
