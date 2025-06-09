getGitHub2FAOTP(userid: string): string {
  // Use the environment variable for the 2FA secret if the user matches
  if (userid === process.env.GH_USER_ID && process.env.GH_USER2_2FA_SECRET) {
    return authenticator.generate(process.env.GH_USER2_2FA_SECRET);
  }
  // Add other users/secrets as needed
  throw new Error("Invalid User ID or missing 2FA secret");
} 