# Saved Searches - Edge Case Testing Guide

This document outlines manual tests to verify edge case handling in the saved searches feature.

## Test Setup

1. Start the application: `python web.py --port 8080`
2. Navigate to Cases page: `http://localhost:8080/app/cases`
3. Open browser DevTools Console to monitor errors

## Test Cases

### 1. Corrupted localStorage Data

**Test**: Manually corrupt localStorage data
```javascript
// In browser console:
localStorage.setItem('saved-searches', 'invalid json{{{');
// Refresh the page
```

**Expected**:
- No crashes
- Console warning: "Saved searches data is corrupted and has been reset"
- Saved searches panel shows empty state
- localStorage is automatically cleared

---

### 2. Invalid Data Structures

**Test**: Store invalid data structure
```javascript
// In browser console:
localStorage.setItem('saved-searches', JSON.stringify({ foo: 'bar' }));
// Refresh the page
```

**Expected**:
- No crashes
- Console warning about corrupted data
- Saved searches panel shows empty state
- localStorage is automatically cleared

---

### 3. Mixed Valid/Invalid Entries

**Test**: Store array with some invalid entries
```javascript
// In browser console:
localStorage.setItem('saved-searches', JSON.stringify([
  { id: 'valid-1', name: 'Valid Search', filters: { court: 'FCA' }, createdAt: '2024-01-01' },
  { id: '', name: 'Invalid' }, // Invalid - no ID
  null, // Invalid
  { id: 'valid-2', name: 'Another Valid', filters: { year: 2020 }, createdAt: '2024-01-02' }
]));
// Refresh the page
```

**Expected**:
- Only 2 valid searches are loaded
- Console warning: "Removed 2 invalid saved search entries"
- Panel shows 2 searches

---

### 4. Empty Search Name

**Test**: Try to save search with empty name
1. Apply any filter (e.g., select a court)
2. Click "Save Search" button
3. Leave name field empty
4. Click "Save" button

**Expected**:
- Error message: "Search name cannot be empty"
- Modal stays open
- Search is not saved

---

### 5. Duplicate Search Name

**Test**: Try to save search with duplicate name
1. Save a search named "Test Search"
2. Try to save another search with name "Test Search" (exact match)
3. Try to save another search with name "test search" (case different)
4. Try to save another search with name "TEST SEARCH" (case different)

**Expected**:
- Each attempt shows error toast: "A search with this name already exists"
- Modal closes
- No duplicate search is created

---

### 6. 50 Search Limit

**Test**: Attempt to exceed the 50 search limit
```javascript
// In browser console - create 50 searches:
const searches = Array.from({ length: 50 }, (_, i) => ({
  id: `search-${i}`,
  name: `Search ${i}`,
  filters: { court: 'FCA' },
  createdAt: new Date().toISOString()
}));
localStorage.setItem('saved-searches', JSON.stringify(searches));
// Refresh the page
```
1. Apply a filter
2. Click "Save Search"
3. Enter name "Search 51"
4. Click "Save"

**Expected**:
- Counter shows "50/50" in amber color
- Warning message displayed: "You've reached the maximum of 50 saved searches..."
- Attempting to save shows error toast: "Cannot save more than 50 searches. Delete some to create new ones."
- Modal closes
- No new search is created

---

### 7. No Active Filters

**Test**: Try to save search with no filters applied
1. Clear all filters (reload page if needed)
2. Click "Save Search" button
3. Enter a name
4. Click "Save"

**Expected**:
- Error message in modal: "Cannot save a search with no filters applied"
- Modal stays open
- Search is not saved

---

### 8. Sort-Only is Not Considered a Filter

**Test**: Try to save search with only sort options
1. Clear all filters
2. Change sort to "Court" ascending (don't apply any actual filters)
3. Click "Save Search"
4. Enter a name
5. Click "Save"

**Expected**:
- Error message: "Cannot save a search with no filters applied"
- Search is not saved

---

### 9. Invalid URL Parameters - Year

**Test**: Navigate with invalid year parameter
```
http://localhost:8080/app/cases?year=invalid
http://localhost:8080/app/cases?year=1800
http://localhost:8080/app/cases?year=2200
```

**Expected**:
- No errors
- Year filter is ignored
- Page loads normally

---

### 10. Invalid URL Parameters - Page

**Test**: Navigate with invalid page parameter
```
http://localhost:8080/app/cases?page=invalid
http://localhost:8080/app/cases?page=-5
http://localhost:8080/app/cases?page=0
http://localhost:8080/app/cases?page=2.5
```

**Expected**:
- No errors
- Page defaults to 1
- Page loads normally

---

### 11. Invalid URL Parameters - Sort Direction

**Test**: Navigate with invalid sort_dir parameter
```
http://localhost:8080/app/cases?sort_dir=invalid
```

**Expected**:
- No errors
- Sort direction defaults to "desc"
- Page loads normally

---

### 12. URL with Missing Params

**Test**: Navigate to cases page with no params
```
http://localhost:8080/app/cases
```

**Expected**:
- No errors
- All filters default to empty/default values
- Page loads normally showing all cases

---

### 13. Whitespace Handling in Names

**Test**: Save search with leading/trailing whitespace
1. Apply a filter
2. Click "Save Search"
3. Enter "  Test Search  " (with spaces)
4. Click "Save"

**Expected**:
- Search is saved with trimmed name: "Test Search"
- No leading/trailing spaces in the saved name

---

### 14. Update to Duplicate Name

**Test**: Try to rename a search to an existing name
1. Save two searches: "Search A" and "Search B"
2. Click edit on "Search A"
3. Try to rename it to "Search B"
4. Click "Update"

**Expected**:
- Error toast: "A search with this name already exists"
- Modal closes
- Name is not updated

---

### 15. Update to Same Name (Case Change)

**Test**: Change only the case of a search name
1. Save a search: "test search"
2. Click edit
3. Rename to "Test Search" (case change only)
4. Click "Update"

**Expected**:
- Update succeeds
- Name is updated to "Test Search"
- Success toast shown

---

### 16. More Than 50 Searches in Storage

**Test**: Load page with 60 searches in localStorage
```javascript
// In browser console:
const searches = Array.from({ length: 60 }, (_, i) => ({
  id: `search-${i}`,
  name: `Search ${i}`,
  filters: { court: 'FCA' },
  createdAt: new Date().toISOString()
}));
localStorage.setItem('saved-searches', JSON.stringify(searches));
// Refresh the page
```

**Expected**:
- Only first 50 searches are loaded
- Excess searches are automatically removed
- Panel shows "50/50"

---

### 17. Empty Search Results

**Test**: Filter saved searches with no matches
1. Save 2-3 searches with names like "FCA", "AATA", "Test"
2. In the search box at top of saved searches panel, type "xyz"

**Expected**:
- "No searches match your query" message displayed
- No search cards shown
- Search box remains functional

---

## Validation Checklist

After running all tests, verify:

- [ ] No console errors (warnings are OK)
- [ ] No application crashes
- [ ] All error messages are user-friendly
- [ ] Invalid data is handled gracefully
- [ ] localStorage is automatically cleaned when corrupted
- [ ] Limits are properly enforced
- [ ] Duplicate detection is case-insensitive
- [ ] Whitespace is trimmed from names
- [ ] URL parameters are validated and defaulted appropriately
- [ ] Empty states are shown when appropriate

## Browser Console Helpers

```javascript
// Clear all saved searches
localStorage.removeItem('saved-searches');

// Check current saved searches
JSON.parse(localStorage.getItem('saved-searches') || '[]');

// Count saved searches
JSON.parse(localStorage.getItem('saved-searches') || '[]').length;

// Create test data - 50 searches at limit
const searches = Array.from({ length: 50 }, (_, i) => ({
  id: `search-${i}`,
  name: `Search ${i}`,
  filters: { court: 'FCA' },
  createdAt: new Date().toISOString()
}));
localStorage.setItem('saved-searches', JSON.stringify(searches));

// Create test data - corrupted
localStorage.setItem('saved-searches', 'invalid{{{');
```

## Expected Console Messages

When edge cases are encountered, you should see these console messages:

- **Corrupted data**: `"Saved searches data is corrupted and has been reset"`
- **Invalid entries**: `"Removed N invalid saved search entries"`
- **Failed to load**: `"Failed to load saved searches:"` (with error details)

## Notes

- All validations should happen before the save operation
- Error messages should be clear and actionable
- The UI should never crash or show broken states
- Invalid data should be cleaned automatically, not cause persistent errors
