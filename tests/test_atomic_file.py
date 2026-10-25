"""Windows sharing errors must never turn an atomic save into data loss."""

import pytest

from immi_case_downloader import atomic_file


@pytest.mark.parametrize("winerror", [5, 32])
def test_replace_retries_a_transient_windows_reader(tmp_path, monkeypatch, winerror):
    destination = tmp_path / "catalog.csv"
    source = tmp_path / "new.tmp"
    destination.write_bytes(b"original")
    source.write_bytes(b"replacement")
    actual_replace = atomic_file.os.replace
    calls = []

    def replace(src, dst):
        calls.append((src, dst))
        assert destination.read_bytes() == b"original"
        if len(calls) == 1:
            error = PermissionError("A reader still holds the destination")
            error.winerror = winerror
            raise error
        actual_replace(src, dst)

    monkeypatch.setattr(atomic_file.os, "replace", replace)
    monkeypatch.setattr(atomic_file.time, "sleep", lambda _: None)
    atomic_file.replace_file(source, destination)
    assert destination.read_bytes() == b"replacement"
    assert not source.exists()


def test_replace_gives_up_without_deleting_either_file(tmp_path, monkeypatch):
    destination = tmp_path / "catalog.csv"
    source = tmp_path / "new.tmp"
    destination.write_bytes(b"original")
    source.write_bytes(b"replacement")
    error = PermissionError("Destination remains locked")
    error.winerror = 32
    monkeypatch.setattr(atomic_file.os, "replace", lambda *_: (_ for _ in ()).throw(error))
    monkeypatch.setattr(atomic_file.time, "sleep", lambda _: None)
    with pytest.raises(PermissionError):
        atomic_file.replace_file(source, destination)
    assert destination.read_bytes() == b"original"
    assert source.read_bytes() == b"replacement"


def test_replace_does_not_retry_other_permission_failures(tmp_path, monkeypatch):
    def denied(*_):
        raise PermissionError("Not a Windows sharing error")

    monkeypatch.setattr(atomic_file.os, "replace", denied)
    monkeypatch.setattr(atomic_file.time, "sleep", lambda _: pytest.fail("Unexpected retry"))
    with pytest.raises(PermissionError):
        atomic_file.replace_file(tmp_path / "new.tmp", tmp_path / "catalog.csv")
