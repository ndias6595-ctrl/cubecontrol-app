import { Redirect } from "expo-router";

/**
 * Magic-link landing route. The actual session completion happens in the
 * AppStore `Linking` listener (this route only avoids the "+not-found" screen).
 */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
