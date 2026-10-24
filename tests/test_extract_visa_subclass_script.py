from scripts.extract_visa_subclass import SUBCLASS_TO_CLASS


def test_safe_haven_enterprise_subclass_790_maps_to_class_xe() -> None:
    assert SUBCLASS_TO_CLASS["790"] == "XE"
