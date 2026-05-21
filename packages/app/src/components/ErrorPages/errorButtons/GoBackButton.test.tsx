import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';

import { GoBackButton } from './GoBackButton';

const mockNavigate = jest.fn();

// useNavigate is mocked, so no router context (MemoryRouter) is needed.
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('../../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const setHistoryLength = (length: number) =>
  Object.defineProperty(window.history, 'length', {
    value: length,
    configurable: true,
  });

const renderButton = () => render(<GoBackButton />);

describe('GoBackButton', () => {
  const originalHistoryLength = window.history.length;

  afterEach(() => {
    jest.clearAllMocks();
    setHistoryLength(originalHistoryLength);
  });

  it('navigates back when there is history to go back to', async () => {
    setHistoryLength(3);

    renderButton();
    await userEvent.click(
      screen.getByRole('button', { name: 'app.errors.goBack' }),
    );

    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it('renders nothing when there is no meaningful history', () => {
    setHistoryLength(1);

    renderButton();

    expect(
      screen.queryByRole('button', { name: 'app.errors.goBack' }),
    ).not.toBeInTheDocument();
  });
});
