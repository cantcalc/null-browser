import React, { useId } from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  'aria-label': string;
  disabled?: boolean;
  id?: string;
}

/** A real keyboard-operable switch, not a restyled native checkbox. */
export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, onCheckedChange, disabled, id, 'aria-label': label }) => {
  const generatedId = useId();
  return (
    <button id={id || generatedId} type="button" role="switch" aria-label={label}
      aria-checked={checked} disabled={disabled} className="null-switch"
      onClick={() => onCheckedChange(!checked)}>
      <span className="null-switch-thumb" aria-hidden="true" />
    </button>
  );
};
