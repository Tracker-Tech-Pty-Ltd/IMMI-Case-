"""Regression coverage for the actual deployment materialisation and release gate."""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import textwrap

import pytest

from scripts.check_immi_activation_evidence import _config_digest, main as activation_main
from tests.test_immi_activation_evidence import _evidence


ROOT = Path(__file__).resolve().parents[1]


def _step_run(name: str) -> str:
    lines = (ROOT / ".github/workflows/deploy-worker.yml").read_text().splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == f"- name: {name}")
    end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("      - name:")), len(lines))
    for index in range(start + 1, end):
        if lines[index].startswith("        run: "):
            value = lines[index].removeprefix("        run: ")
            if value in {"|", ">-"}:
                return textwrap.dedent("\n".join(lines[index + 1:end])).strip()
            return value
    raise AssertionError(f"No executable run block for {name}")


@pytest.mark.parametrize("pipeline_entry", ["src/index.ts", "workers/austlii-scraper/src/index.ts"])
def test_materialised_configs_resolve_both_actual_worker_entries(tmp_path, pipeline_entry):
    checkout = tmp_path / "checkout"
    temporary = tmp_path / "runner-temp"
    checkout.mkdir()
    temporary.mkdir()
    (checkout / "workers/austlii-scraper/src").mkdir(parents=True)
    (checkout / "workers/cloudflare-native.js").write_text("export default {};\n")
    (checkout / "workers/austlii-scraper/src/index.ts").write_text("export default {};\n")
    materialiser = ROOT / "scripts/materialize_immi_native_configs.py"
    if materialiser.exists():
        (checkout / "scripts").mkdir()
        shutil.copy2(materialiser, checkout / "scripts")
    env = dict(os.environ, GITHUB_WORKSPACE=str(checkout), RUNNER_TEMP=str(temporary), GITHUB_ENV=str(temporary / "env"))
    env["MAIN_CONFIG_B64"] = base64.b64encode(b'main = "workers/cloudflare-native.js"\n').decode()
    env["PIPELINE_CONFIG_B64"] = base64.b64encode(f'main = "{pipeline_entry}"\n'.encode()).decode()
    subprocess.run(["bash", "-euc", _step_run("Materialise operator-supplied native configs")], cwd=checkout, env=env, check=True)
    if (temporary / "env").exists():
        env.update(line.split("=", 1) for line in (temporary / "env").read_text().splitlines())
    import tomllib

    for name in ("Deploy native main Worker", "Deploy native pipeline Worker"):
        command = _step_run(name)
        for key, value in env.items():
            command = command.replace(f"${key}", value).replace("${" + key + "}", value)
        args = shlex.split(command)
        config = Path(args[args.index("--config") + 1])
        if not config.is_absolute():
            config = checkout / config
        parsed = tomllib.loads(config.read_text())
        assert (config.parent / parsed["main"]).is_file(), name


def _packet(tmp_path):
    evidence = _evidence()
    main = tmp_path / "main.toml"
    pipeline = tmp_path / "pipeline.toml"
    databases = evidence["d1_resources"]["databases"]
    content = evidence["object_resources"]["r2"]["IMMI_CONTENT"]["bucket_name"]
    vector = evidence["object_resources"]["vectorize"]["CASE_VECTORS"]["index_name"]
    def database_lines(names):
        return "\n".join(f'[[d1_databases]]\nbinding = "{name}"\ndatabase_id = "{databases[name]["database_id"]}"' for name in names)
    main.write_text(database_lines(databases) + f'\n[[r2_buckets]]\nbinding = "IMMI_CONTENT"\nbucket_name = "{content}"\n[[vectorize]]\nbinding = "CASE_VECTORS"\nindex_name = "{vector}"\n')
    pipeline.write_text(database_lines(("IMMI_CATALOG_DB", "IMMI_OPS_DB")) + f'\n[[r2_buckets]]\nbinding = "CASE_RESULTS"\nbucket_name = "{content}"\n')
    evidence["release"]["config_digest"] = _config_digest(main, pipeline)
    packet = tmp_path / "packet.json"
    packet.write_text(json.dumps(evidence))
    return packet, main, pipeline, evidence


def test_release_gate_rejects_evidence_for_a_different_checkout(tmp_path, capsys):
    packet, main, pipeline, _ = _packet(tmp_path)
    assert activation_main([str(packet), "--main-config", str(main), "--pipeline-config", str(pipeline)]) == 2
    assert "git_sha" in capsys.readouterr().err


@pytest.mark.parametrize("git_sha", ["0" * 40, "f" * 40])
def test_release_gate_rejects_fabricated_source_identity(tmp_path, git_sha):
    packet, main, pipeline, evidence = _packet(tmp_path)
    evidence["release"]["git_sha"] = git_sha
    packet.write_text(json.dumps(evidence))
    assert activation_main([str(packet), "--main-config", str(main), "--pipeline-config", str(pipeline)]) == 2


def _clean_checkout(tmp_path, monkeypatch):
    source = tmp_path / "source"
    source.mkdir()
    subprocess.run(["git", "init", "-q", str(source)], check=True)
    (source / "worker.js").write_text("export default {};\n")
    subprocess.run(["git", "add", "worker.js"], cwd=source, check=True)
    subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "test: fixture"], cwd=source, check=True)
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip()
    monkeypatch.setattr("scripts.check_immi_activation_evidence.ROOT", source)
    return source, sha


def test_release_gate_accepts_the_exact_pristine_source_checkout(tmp_path, monkeypatch):
    _, sha = _clean_checkout(tmp_path, monkeypatch)
    packet, main, pipeline, evidence = _packet(tmp_path)
    evidence["release"]["git_sha"] = sha
    packet.write_text(json.dumps(evidence))
    assert activation_main([str(packet), "--main-config", str(main), "--pipeline-config", str(pipeline)]) == 0


@pytest.mark.parametrize("staged", [False, True])
def test_release_gate_rejects_uncommitted_source_changes(tmp_path, monkeypatch, staged):
    source, sha = _clean_checkout(tmp_path, monkeypatch)
    packet, main, pipeline, evidence = _packet(tmp_path)
    evidence["release"]["git_sha"] = sha
    packet.write_text(json.dumps(evidence))
    (source / "worker.js").write_text("throw new Error('untested');\n")
    if staged:
        subprocess.run(["git", "add", "worker.js"], cwd=source, check=True)
    assert activation_main([str(packet), "--main-config", str(main), "--pipeline-config", str(pipeline)]) == 2
