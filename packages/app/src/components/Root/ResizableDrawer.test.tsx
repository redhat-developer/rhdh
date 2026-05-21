import { renderInTestApp } from '@backstage/test-utils';

import { screen } from '@testing-library/react';

import { ResizableDrawer } from './ResizableDrawer';

describe('ResizableDrawer', () => {
  it('renders its children while open', async () => {
    await renderInTestApp(
      <ResizableDrawer isDrawerOpen>
        <div>drawer content</div>
      </ResizableDrawer>,
    );

    expect(screen.getByText('drawer content')).toBeInTheDocument();
  });

  it('registers window resize listeners only when resizable', async () => {
    const addSpy = jest.spyOn(globalThis, 'addEventListener');

    await renderInTestApp(
      <ResizableDrawer isDrawerOpen isResizable>
        <div>drawer content</div>
      </ResizableDrawer>,
    );

    expect(addSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(addSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));

    addSpy.mockRestore();
  });

  it('drives onWidthChange from a resize drag', async () => {
    const onWidthChange = jest.fn();
    const addSpy = jest.spyOn(globalThis, 'addEventListener');

    await renderInTestApp(
      <ResizableDrawer
        isDrawerOpen
        isResizable
        minWidth={400}
        maxWidth={800}
        onWidthChange={onWidthChange}
      >
        <div>drawer content</div>
      </ResizableDrawer>,
    );

    // Start a drag by flipping the internal resizing flag via the handle, then
    // move the mouse. Width for a right-anchored drawer is innerWidth - clientX.
    const handle = document.querySelector(
      '[class*="MuiBox-root"] > div:last-child',
    );
    handle?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    const moveHandler = addSpy.mock.calls.find(
      ([event]) => event === 'mousemove',
    )?.[1] as (e: MouseEvent) => void;
    globalThis.innerWidth = 1000;
    moveHandler(new MouseEvent('mousemove', { clientX: 400 }));

    expect(onWidthChange).toHaveBeenCalledWith(600);

    addSpy.mockRestore();
  });

  it('stops resizing after mouse up', async () => {
    const onWidthChange = jest.fn();
    const addSpy = jest.spyOn(globalThis, 'addEventListener');

    await renderInTestApp(
      <ResizableDrawer
        isDrawerOpen
        isResizable
        minWidth={400}
        maxWidth={800}
        onWidthChange={onWidthChange}
      >
        <div>drawer content</div>
      </ResizableDrawer>,
    );

    const handle = document.querySelector(
      '[class*="MuiBox-root"] > div:last-child',
    );
    handle?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    const findHandler = (event: string) =>
      addSpy.mock.calls.find(([name]) => name === event)?.[1] as (
        e: MouseEvent,
      ) => void;

    // Ending the drag should make subsequent moves no-ops.
    findHandler('mouseup')(new MouseEvent('mouseup'));
    globalThis.innerWidth = 1000;
    findHandler('mousemove')(new MouseEvent('mousemove', { clientX: 400 }));

    expect(onWidthChange).not.toHaveBeenCalled();

    addSpy.mockRestore();
  });
});
