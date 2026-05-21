import { renderInTestApp } from '@backstage/test-utils';

import { render, screen } from '@testing-library/react';

import { ResizableDrawer } from './ResizableDrawer';

// The resize handle is an unlabelled styled div; locate it by structure and
// assert it was found so a structural change fails loudly instead of silently
// skipping the drag.
const startDragFromHandle = () => {
  const handle = document.querySelector(
    '[class*="MuiBox-root"] > div:last-child',
  );
  expect(handle).not.toBeNull();
  handle!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
};

const findWindowHandler = (addSpy: jest.SpyInstance, event: string) =>
  addSpy.mock.calls.find(([name]) => name === event)?.[1] as (
    e: MouseEvent,
  ) => void;

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

    // Width for a right-anchored drawer is innerWidth - clientX.
    startDragFromHandle();
    globalThis.innerWidth = 1000;
    findWindowHandler(
      addSpy,
      'mousemove',
    )(new MouseEvent('mousemove', { clientX: 400 }));

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

    startDragFromHandle();

    // Ending the drag should make subsequent moves no-ops.
    findWindowHandler(addSpy, 'mouseup')(new MouseEvent('mouseup'));
    globalThis.innerWidth = 1000;
    findWindowHandler(
      addSpy,
      'mousemove',
    )(new MouseEvent('mousemove', { clientX: 400 }));

    expect(onWidthChange).not.toHaveBeenCalled();

    addSpy.mockRestore();
  });

  it('re-clamps and reports when the external width drops below the minimum', () => {
    const onWidthChange = jest.fn();
    const drawer = (drawerWidth: number) => (
      <ResizableDrawer
        isDrawerOpen
        isResizable
        minWidth={400}
        drawerWidth={drawerWidth}
        onWidthChange={onWidthChange}
      >
        <div>drawer content</div>
      </ResizableDrawer>
    );

    // Initial width (500) is already within range, so nothing is reported.
    const { rerender } = render(drawer(500));
    expect(onWidthChange).not.toHaveBeenCalled();

    // Dropping the external width below the minimum re-clamps to 400 and
    // reports the corrected width back to the parent.
    rerender(drawer(100));
    expect(onWidthChange).toHaveBeenCalledWith(400);
  });
});
