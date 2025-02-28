import React from "react";

import type { StylesOptions } from "@material-ui/styles";

// It's neccessary that this provider is loaded from `core/styles` not just `styles`!
import {
  StylesProvider as WrappedStylesProvider,
  jssPreset,
} from "@material-ui/core/styles";
import { create as createJss } from "jss";

/**
 * Creates a new JSS StylesProvider that inserts additional styles
 * to the current (react and browser) dom position.
 * This is only useful in a shadow root world because MUI v4 component
 * styles are handled globally.
 */
export const ShadowRootStylesProvider = ({ children }: { children: any }) => {
  const [insertionPoint, setInsertionPoint] =
    React.useState<HTMLDivElement | null>(null);

  const stylesOptions = React.useMemo<StylesOptions | null>(() => {
    if (!insertionPoint) {
      return null;
    }
    return {
      jss: createJss({
        ...jssPreset(),
        insertionPoint,
      }),
      sheetsManager: new Map(),
    };
  }, [insertionPoint]);

  return (
    <div>
      <div ref={setInsertionPoint} />
      {stylesOptions ? (
        <WrappedStylesProvider {...stylesOptions}>
          {children}
        </WrappedStylesProvider>
      ) : null}
    </div>
  );
};
