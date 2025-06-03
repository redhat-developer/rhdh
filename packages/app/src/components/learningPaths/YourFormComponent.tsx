import React from 'react';
import { Controller, SubmitHandler, useForm } from 'react-hook-form'; // Import useForm

import Box from '@mui/material/Box';
import Button from '@mui/material/Button'; // For a submit button example
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import Grid from '@mui/material/Grid';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';

// Define a type for your form values (good practice if using TypeScript)
interface IMyFormInputs {
  // Use the name you've given to your Controller component
  // If replacing original, it might be "csi_sector"
  // For the test, we used "csi_sector_test_rhf"
  csi_sector_test_rhf: string;
  // Add other form field names here if they are part of this form
}

// --- Start of Test Data (as before) ---
const MOCK_SECTOR_TYPES = [
  { value: 'tech_1', label: 'Technology & Communications Services Group A' },
  {
    value: 'health_2',
    label:
      'Healthcare and Pharmaceutical Services Division B - A very long label to test wrapping properly',
  },
  { value: 'finance_3', label: 'Financial Institutions and Banking Sector C' },
];

// For testing, you might want to simulate an error submission or initial state.
// However, react-hook-form's `errors` object is the proper way to handle real errors.
// Let's set up a default value to make the form work.
// --- End of Test Data ---

// This is an example of a component that would render your form including the Select
const YourFormComponent: React.FC = () => {
  const {
    control, // THIS IS THE 'control' OBJECT that Controller needs
    handleSubmit,
    formState: { errors }, // 'errors' object contains validation errors
  } = useForm<IMyFormInputs>({
    // Provide default values for your form fields
    defaultValues: {
      csi_sector_test_rhf: '', // Or a specific default like MOCK_SECTOR_TYPES[0]?.value
    },
    // You can define validation mode, e.g., mode: 'onChange'
  });

  // Example submit handler
  const onSubmit: SubmitHandler<IMyFormInputs> = data => {
    // Here you would typically send data to an API or handle it further
  };

  // For the test, decide if you want to force an error display or use RHF's errors
  // To force error display for visual testing:
  const FORCE_TEST_ERROR_DISPLAY = false; // Set to true to see error styles
  const FORCED_TEST_ERROR_MESSAGE =
    'This is a forced error message for testing.';

  // Determine error state for the specific field
  const fieldError = errors.csi_sector_test_rhf;
  const displayError = FORCE_TEST_ERROR_DISPLAY || !!fieldError;
  const helperText = FORCE_TEST_ERROR_DISPLAY
    ? FORCED_TEST_ERROR_MESSAGE
    : fieldError?.message;

  return (
    // The form element should use the handleSubmit from react-hook-form
    <form onSubmit={handleSubmit(onSubmit)}>
      <Grid container spacing={2}>
        {' '}
        {/* Optional: For layout */}
        {/* Your Test Select Grid Item */}
        <Grid item xs={12}>
          <Box sx={{ padding: 2, border: '2px dashed blue' }}>
            {' '}
            {/* Visual aid for the test box */}
            <FormControl
              variant="standard"
              fullWidth
              error={displayError} // Use the determined error state
            >
              <InputLabel id="csi_sector_test_label">
                Sector (Test with Controller)
              </InputLabel>
              <Controller
                name="csi_sector_test_rhf" // Must match a key in IMyFormInputs
                control={control} // HERE you pass the control object
                // rules={{ required: 'Sector is required' }} // Example validation rule
                render={(
                  { field, fieldState }, // fieldState.error is specific to this Controller
                ) => (
                  <Select
                    labelId="csi_sector_test_label"
                    id="csi_sector_test"
                    label="Sector (Test with Controller)" // Match InputLabel text
                    value={field.value} // Controlled by react-hook-form
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    variant="standard"
                    error={!!fieldState.error} // Error state from this specific field
                  >
                    <MenuItem value="">
                      <em>Select a Sector...</em>
                    </MenuItem>
                    {MOCK_SECTOR_TYPES.map(sector => (
                      <MenuItem key={sector.value} value={sector.value}>
                        <Typography style={{ whiteSpace: 'normal' }}>
                          {sector.label}
                        </Typography>
                      </MenuItem>
                    ))}
                  </Select>
                )}
              />
              {displayError && <FormHelperText>{helperText}</FormHelperText>}
            </FormControl>
          </Box>
        </Grid>
        {/* Example Submit Button */}
        <Grid item xs={12}>
          <Button type="submit" variant="contained" color="primary">
            Submit Test Form
          </Button>
        </Grid>
      </Grid>
    </form>
  );
};

export default YourFormComponent;
