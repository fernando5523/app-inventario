import type { JSX } from 'react';
import Svg, { Path } from 'react-native-svg';

export interface EstrellaMarcaProps {
  size?: number;
  color: string;
}

/**
 * La estrella de cuatro puntas de brazos cóncavos que corona el wordmark
 * Trujillo — no es un ícono genérico, es parte de la marca. Path exacto de
 * mobile/design/login.html (copiado textual, no reinterpretado).
 */
export function EstrellaMarca({ size = 16, color }: EstrellaMarcaProps): JSX.Element {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 1c1.3 8.4 2.3 9.4 10.7 10.7C14.3 13 13.3 14 12 22.4 10.7 14 9.7 13 1.3 11.7 9.7 10.4 10.7 9.4 12 1Z"
        fill={color}
      />
    </Svg>
  );
}
