# Authenticated notes and persistence

## Sub-features

Create text notes, read exact content, retain notes after server restart, deny anonymous API access.

## How to get to it (user POV)

Open the helper's loopback URL, sign into the copied synthetic fixture and select the verification note from the note tree or search.

## Driving it with HTTP and CUA

Launch the helper, send `doctor`, `drive`, `restart`, then observe the named note with CUA. Expected state is the same note ID, title and content after restart. Save a screenshot and snapshot. Send `cleanup` and confirm evidence survives.

## Gotchas

The profile is seeded with the checked-in fixture. This does not verify first-time initialization, sync to an external service, production credentials or a new desktop installation.
