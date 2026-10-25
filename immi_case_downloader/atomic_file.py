"""Atomic publication with a bounded retry for Windows sharing violations."""

import os
import time


def replace_file(source, destination) -> None:
    """Keep the destination intact until a closed temporary file can replace it.

    Windows readers can briefly prevent rename even after the writer closes
    its handle. Retry only those access/sharing errors, never delete the live
    destination to make publication succeed.
    """
    for attempt in range(6):
        try:
            os.replace(source, destination)
            return
        except PermissionError as error:
            if getattr(error, "winerror", None) not in (5, 32) or attempt == 5:
                raise
            time.sleep(0.02 * 2 ** attempt)
