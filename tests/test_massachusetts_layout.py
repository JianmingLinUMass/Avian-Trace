"""Mirrored layout, prototype semantics and copy-only migration fixtures."""
import argparse
import ast
from contextlib import redirect_stdout
import io
import math
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from scripts import extract_massachusetts as export
from scripts import massachusetts_layout as layout
from scripts import prototype_normalization as normal
from scripts.extract_production import FIELDS, SCHEMA


class MirrorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="avian-ma-layout-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "nationwide-fixture"
        self.source.mkdir()
        self.prototype = self.root / "prototype"
        self.prototype.mkdir()
        for name, fields in layout.TABLE_FIELDS.items():
            schema = pa.schema(fields)
            pq.write_table(pa.Table.from_pylist([], schema=schema), self.prototype / (name+".parquet"))
        self.reference = self.root / "validated-ma"
        self.output = self.root / "parquet_ma"
        self.args = argparse.Namespace(input=self.source, output=self.output, reuse_export=self.reference,
            prototype_dir=self.prototype, temp_directory=None, resume=False, max_files=None,
            batch_size=1, file_size_mib=1, memory_limit="256MB", threads=1)
        def row(identifier, **changes):
            value = dict.fromkeys(FIELDS.values())
            value.update(observation_id=identifier, checklist_id="C1", taxon_id="T1", locality_id="L1",
                observation_date="1831-03-22", count_raw="1_2", locality_name="Old locality",
                latitude="42.0", longitude="-71.0", state_code="US-MA", county_code="US-MA-017",
                common_name="Old bird", scientific_name="Old scientific", category="species", taxonomic_order="1_001")
            value.update(changes)
            return value
        self.rows = [row("duplicate"), row("duplicate"),
            row("new", locality_name="New locality", common_name="New bird", latitude="nan", count_raw="1.5"),
            row("null", taxon_id=None, locality_id=None, checklist_id=None, observation_date=None, count_raw=None),
            row("later", taxon_id="T2", locality_id="L2", observation_date="2026-09-30", count_raw="+١_٢", latitude="inf"),
            row("other-state", state_code="US-NY")]

    def make_reference(self, rows=None):
        pq.write_table(pa.Table.from_pylist(rows or self.rows, schema=SCHEMA), self.source / "part_00000.parquet")
        args = argparse.Namespace(**vars(self.args))
        args.output = self.reference
        with redirect_stdout(io.StringIO()):
            export.run_export(args)

    def run_mirror(self):
        with redirect_stdout(io.StringIO()):
            return layout.run_mirror(self.args)

    def validate(self):
        with redirect_stdout(io.StringIO()):
            return layout.validate_mirror(self.output, "256MB", 1, self.root / "validation-scratch", self.reference)

    def legacy_catalogs(self):
        # Execute only the original schema/save_batch AST; never import its side-effecting main.
        module = ast.parse((export.ROOT / "scripts/build_tables.py").read_text())
        schema = next(node.value.args[0].value for node in module.body
            if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Attribute) and node.value.func.attr == "executescript")
        save = next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == "save_batch")
        con = sqlite3.connect(":memory:")
        con.execute("PRAGMA foreign_keys=ON")
        con.executescript(schema)
        scope = {"conn": con, "integer_or_none": normal.integer_or_none, "float_or_none": normal.float_or_none}
        exec(compile(ast.Module(body=[save], type_ignores=[]), "prototype-save-batch", "exec"), scope)
        raw = []
        with duckdb.connect() as reader:
            for path in sorted(self.reference.glob("batch_*/*.parquet")):
                records = reader.execute("SELECT * EXCLUDE(file_row_number) FROM read_parquet(?,file_row_number=true) ORDER BY file_row_number", [str(path)]).fetchall()
                raw.extend({source: record[index] or "" for index, (source, target) in enumerate(FIELDS.items())} for record in records)
        for start in range(0, len(raw), normal.CATALOG_BATCH_SIZE):
            scope["save_batch"](raw[start:start+normal.CATALOG_BATCH_SIZE])
        result = {name: con.execute("SELECT * FROM " + name + " ORDER BY 1").fetchall() for name in ["locations", "taxa"]}
        con.close()
        return result

    def test_copy_only_migration_schemas_normalization_and_conflicts(self):
        self.make_reference()
        before = {str(path.relative_to(self.reference)): export.sha256(path) for path in self.reference.rglob("*") if path.is_file()}
        with patch.object(export, "verify_source", side_effect=AssertionError("Nationwide source was touched")):
            report = self.run_mirror()
        self.assertEqual(report["production_rows"], 5)
        self.assertEqual(report["root_tables"]["observations"]["rows"], 5)
        self.assertFalse(self.output.with_name("parquet_ma.incomplete").exists())
        copied = sorted((self.output / "production").glob("*.parquet"))
        self.assertEqual(len(copied), 1)
        original = next(self.reference.glob("batch_*/*.parquet"))
        self.assertEqual(export.sha256(copied[0]), export.sha256(original))
        for name, fields in layout.TABLE_FIELDS.items():
            self.assertTrue(pq.read_schema(self.output / (name+".parquet")).equals(pq.read_schema(self.prototype / (name+".parquet"))))
        catalogs = self.legacy_catalogs()
        with duckdb.connect() as con:
            for name in catalogs:
                self.assertEqual(con.execute("SELECT * FROM read_parquet(?) ORDER BY 1", [str(self.output/(name+".parquet"))]).fetchall(), catalogs[name])
            counts = con.execute("SELECT observation_id,count_raw,observation_count,checklist_id,observation_date FROM read_parquet(?) ORDER BY observation_id", [str(self.output/'observations.parquet')]).fetchall()
            self.assertEqual(sum(row[0]=='duplicate' and row[2]==12 for row in counts), 2)
            self.assertEqual(next(row[2] for row in counts if row[0]=='new'), None)  # Python int('1.5'), never rounding.
            self.assertEqual(next(row[2] for row in counts if row[0]=='later'), 12)
            self.assertEqual(next(row[1:] for row in counts if row[0]=='null'), ('',None,'',''))
        self.assertEqual(report['catalog_conflicts']['locations']['conflicting_ids'], 1)
        self.assertEqual(report['catalog_conflicts']['locations']['records_with_nonselected_metadata'], 2)
        self.assertEqual(report['catalog_conflicts']['taxa']['conflicting_ids'], 1)
        self.assertEqual(report['minimum_date'], '1831-03-22')
        for relative, checksum in before.items():
            self.assertEqual(export.sha256(self.reference/relative), checksum)
        self.assertTrue(self.validate()['passed'])
        # Data can be queried after both the nationwide fixture and old export disappear.
        self.source.rename(self.root/'source-unavailable')
        self.reference.rename(self.root/'reference-unavailable')
        with redirect_stdout(io.StringIO()):
            self.assertTrue(layout.validate_mirror(self.output,'256MB',1,self.root/'audit')['passed'])

    def test_original_first_batch_last_row_policy_not_latest_date(self):
        rows = []
        for index in range(10_002):
            row = dict(self.rows[0], observation_id=str(index))
            row['observation_date'] = '2026-09-30' if index >= 10_000 else '1831-03-22'
            if index == 9999:
                row.update(locality_name='First batch winner', common_name='First batch bird')
            if index >= 10_000:
                row.update(locality_name='Later ignored', common_name='Later bird ignored')
            rows.append(row)
        self.make_reference(rows)
        self.run_mirror()
        expected = self.legacy_catalogs()
        with duckdb.connect() as con:
            for name in expected:
                actual=con.execute('SELECT * FROM read_parquet(?) ORDER BY 1',[str(self.output/(name+'.parquet'))]).fetchall()
                self.assertEqual(actual,expected[name])
            self.assertEqual(con.execute('SELECT locality_name FROM read_parquet(?)',[str(self.output/'locations.parquet')]).fetchone()[0],'First batch winner')

    def test_failed_validation_resume_reuses_byte_copies(self):
        self.make_reference()
        with patch.object(layout,'validate_mirror',side_effect=ValueError('Forced validation failure')):
            with self.assertRaisesRegex(ValueError,'Forced validation'):
                self.run_mirror()
        self.assertFalse(self.output.exists())
        staging=self.output.with_name('parquet_ma.incomplete')
        path=next((staging/'production').glob('*.parquet'))
        stamp=path.stat().st_mtime_ns
        self.args.resume=True
        with patch.object(layout.shutil,'copyfile',side_effect=AssertionError('Copied completed part again')):
            self.run_mirror()
        self.assertEqual(next((self.output/'production').glob('*.parquet')).stat().st_mtime_ns,stamp)

    def test_reference_change_and_existing_destination_are_rejected(self):
        self.make_reference()
        with patch.object(layout,'validate_mirror',side_effect=ValueError('Stop')):
            with self.assertRaisesRegex(ValueError,'Stop'):
                self.run_mirror()
        self.args.resume=True
        manifest=self.reference/'manifest.json'
        original=manifest.read_bytes()
        manifest.write_bytes(original+b' ')
        with self.assertRaisesRegex(ValueError,'changed'):
            self.run_mirror()
        manifest.write_bytes(original)
        self.run_mirror()
        with self.assertRaisesRegex(ValueError,'refusing to overwrite'):
            self.run_mirror()

    def test_catalog_corruption_fails_fresh_audit(self):
        self.make_reference()
        self.run_mirror()
        path=self.output/'taxa.parquet'
        path.write_bytes(b'corrupt')
        with self.assertRaises(Exception):
            self.validate()

    def test_fresh_extraction_default_layout(self):
        pq.write_table(pa.Table.from_pylist(self.rows,schema=SCHEMA),self.source/'part_00000.parquet')
        self.args.reuse_export=None
        report=self.run_mirror()
        self.assertTrue(report['passed'])
        self.assertFalse((self.output/'.source_export').exists())
        with redirect_stdout(io.StringIO()):
            self.assertTrue(layout.validate_mirror(self.output,'256MB',1,self.root/'audit')['passed'])

    def test_duplicate_multiplicity_corruption_is_detected_even_with_updated_checksum(self):
        self.make_reference()
        self.run_mirror()
        path=self.output/'observations.parquet'
        temporary=self.root/'wrong.parquet'
        with duckdb.connect() as con:
            con.execute('CREATE TABLE changed AS SELECT * FROM read_parquet(?)',[str(path)])
            con.execute("DELETE FROM changed WHERE rowid=(SELECT MIN(rowid) FROM changed WHERE observation_id='duplicate')")
            con.execute("INSERT INTO changed SELECT * FROM changed WHERE observation_id='later' LIMIT 1")
            con.execute("SET disabled_optimizers='statistics_propagation'")
            con.execute('COPY changed TO ? (FORMAT PARQUET)',[str(temporary)])
        temporary.replace(path)
        manifest=layout.load_mirror(self.output)
        manifest['tables']['observations']=layout.file_record(path,layout.schema_of(manifest['plan'],'observations'))
        export.atomic_json(self.output/'manifest.json',manifest)
        with self.assertRaisesRegex(ValueError,'normalized rows'):
            self.validate()

    def test_fresh_publish_interruption_resumes_without_reextracting(self):
        pq.write_table(pa.Table.from_pylist(self.rows,schema=SCHEMA),self.source/'part_00000.parquet')
        self.args.reuse_export=None
        original=Path.rename
        staging=self.output.with_name('parquet_ma.incomplete')
        def stop_publication(path,target):
            if path==staging:
                raise OSError('Interrupted publication')
            return original(path,target)
        with patch.object(Path,'rename',stop_publication):
            with self.assertRaisesRegex(OSError,'Interrupted publication'):
                self.run_mirror()
        self.assertFalse((staging/'.source_export').exists())
        self.args.resume=True
        with patch.object(export,'run_export',side_effect=AssertionError('Re-extracted nationwide data')):
            report=self.run_mirror()
        self.assertTrue(report['passed'])

    def test_float_normalization_matches_sqlite_storage_edges(self):
        con=sqlite3.connect(':memory:')
        con.execute('CREATE TABLE values_table(value REAL)')
        try:
            for raw in ['-0.0','0','nan','inf','-inf','1_000.5','bad',None]:
                con.execute('DELETE FROM values_table')
                con.execute('INSERT INTO values_table VALUES (?)',[normal.float_or_none(raw)])
                expected=con.execute('SELECT value FROM values_table').fetchone()[0]
                actual=normal.sqlite_float(raw)
                self.assertEqual(actual,expected)
                if expected == 0:
                    self.assertEqual(math.copysign(1.0,actual),math.copysign(1.0,expected))
        finally:
            con.close()

    def test_cli_mirror_and_backward_compatible_audits(self):
        self.make_reference()
        cmd=[sys.executable,str(export.ROOT/'scripts/extract_massachusetts.py'),'--reuse-export',str(self.reference),'--output',str(self.output),'--prototype-dir',str(self.prototype),'--input',str(self.source),'--memory-limit','256MB','--threads','1']
        result=subprocess.run(cmd,capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stderr)
        cmd=[sys.executable,str(export.ROOT/'scripts/validate_massachusetts.py'),'--dataset',str(self.output),'--reference-export',str(self.reference),'--memory-limit','256MB','--threads','1']
        result=subprocess.run(cmd,capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stderr)
        cmd=[sys.executable,str(export.ROOT/'scripts/validate_massachusetts.py'),'--dataset',str(self.reference),'--input',str(self.source),'--memory-limit','256MB','--threads','1']
        result=subprocess.run(cmd,capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,0,result.stderr)


if __name__=='__main__':
    unittest.main()
